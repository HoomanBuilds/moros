use crate::{AtomicUsdc, Error, FieldElement, Result};

pub const MAX_SELECTION_CANDIDATES: usize = 96;
type BestCombination = Option<(Vec<usize>, i128, Vec<[u8; 32]>)>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SpendableNote {
    pub amount: AtomicUsdc,
    pub commitment: FieldElement,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TransferBudget {
    pub recipient: AtomicUsdc,
    pub relay_fee: i128,
    pub protocol_fee: i128,
}

impl TransferBudget {
    pub fn total(self) -> Result<i128> {
        if self.relay_fee < 0 || self.protocol_fee < 0 {
            return Err(Error::InvalidAmount);
        }
        self.recipient
            .atomic()
            .checked_add(self.relay_fee)
            .and_then(|value| value.checked_add(self.protocol_fee))
            .ok_or(Error::AmountOverflow)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoteSelection {
    pub input_indices: Vec<usize>,
    pub circuit_arity: u8,
    pub input_total: i128,
    pub change: i128,
}

impl NoteSelection {
    pub fn select(notes: &[SpendableNote], budget: TransferBudget) -> Result<Self> {
        if notes.len() > MAX_SELECTION_CANDIDATES {
            return Err(Error::TooManySpendableNotes);
        }
        let required = budget.total()?;
        let mut candidates: Vec<(usize, &SpendableNote)> = notes.iter().enumerate().collect();
        candidates.sort_by(|left, right| {
            left.1.amount.cmp(&right.1.amount).then_with(|| {
                left.1
                    .commitment
                    .to_le_bytes()
                    .cmp(&right.1.commitment.to_le_bytes())
            })
        });

        for input_count in 1..=4 {
            if let Some((indices, total)) = best_combination(&candidates, input_count, required)? {
                let circuit_arity = match input_count {
                    1 => 1,
                    2 => 2,
                    3 | 4 => 4,
                    _ => unreachable!(),
                };
                return Ok(Self {
                    input_indices: indices,
                    circuit_arity,
                    input_total: total,
                    change: total
                        .checked_sub(required)
                        .ok_or(Error::ValueConservation)?,
                });
            }
        }
        Err(Error::InsufficientPrivateBalance)
    }

    pub fn verify(&self, notes: &[SpendableNote], budget: TransferBudget) -> Result<()> {
        if self.input_indices.is_empty()
            || self.input_indices.len() > 4
            || self.circuit_arity
                != match self.input_indices.len() {
                    1 => 1,
                    2 => 2,
                    3 | 4 => 4,
                    _ => return Err(Error::ValueConservation),
                }
        {
            return Err(Error::ValueConservation);
        }
        let mut seen = Vec::with_capacity(self.input_indices.len());
        let mut input_total = 0_i128;
        for index in &self.input_indices {
            if seen.contains(index) {
                return Err(Error::ValueConservation);
            }
            seen.push(*index);
            input_total = input_total
                .checked_add(
                    notes
                        .get(*index)
                        .ok_or(Error::ValueConservation)?
                        .amount
                        .atomic(),
                )
                .ok_or(Error::AmountOverflow)?;
        }
        let required = budget.total()?;
        if input_total != self.input_total
            || self.change < 0
            || required.checked_add(self.change) != Some(input_total)
        {
            return Err(Error::ValueConservation);
        }
        Ok(())
    }
}

fn best_combination(
    candidates: &[(usize, &SpendableNote)],
    count: usize,
    required: i128,
) -> Result<Option<(Vec<usize>, i128)>> {
    let mut best: BestCombination = None;
    let mut positions = Vec::with_capacity(count);
    visit_combinations(candidates, count, 0, 0, required, &mut positions, &mut best)?;
    Ok(best.map(|(indices, total, _)| (indices, total)))
}

#[allow(clippy::too_many_arguments)]
fn visit_combinations(
    candidates: &[(usize, &SpendableNote)],
    remaining: usize,
    start: usize,
    running_total: i128,
    required: i128,
    positions: &mut Vec<usize>,
    best: &mut BestCombination,
) -> Result<()> {
    if remaining == 0 {
        if running_total < required {
            return Ok(());
        }
        let indices: Vec<usize> = positions
            .iter()
            .map(|position| candidates[*position].0)
            .collect();
        let commitments: Vec<[u8; 32]> = positions
            .iter()
            .map(|position| candidates[*position].1.commitment.to_le_bytes())
            .collect();
        let replace = best
            .as_ref()
            .is_none_or(|(_, best_total, best_commitments)| {
                running_total < *best_total
                    || (running_total == *best_total && commitments < *best_commitments)
            });
        if replace {
            *best = Some((indices, running_total, commitments));
        }
        return Ok(());
    }

    if remaining > candidates.len().saturating_sub(start) {
        return Ok(());
    }

    let last_start = candidates.len() - remaining;
    for position in start..=last_start {
        let amount = candidates[position].1.amount.atomic();
        let total = running_total
            .checked_add(amount)
            .ok_or(Error::AmountOverflow)?;
        if best
            .as_ref()
            .is_some_and(|(_, best_total, _)| total > *best_total)
        {
            break;
        }
        positions.push(position);
        visit_combinations(
            candidates,
            remaining - 1,
            position + 1,
            total,
            required,
            positions,
            best,
        )?;
        positions.pop();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_notes(amounts: &[i128]) -> Vec<SpendableNote> {
        amounts
            .iter()
            .enumerate()
            .map(|(index, amount)| SpendableNote {
                amount: AtomicUsdc::new(*amount).unwrap(),
                commitment: FieldElement::from_u64(index as u64 + 1),
            })
            .collect()
    }

    fn budget(amount: i128) -> TransferBudget {
        TransferBudget {
            recipient: AtomicUsdc::new(amount).unwrap(),
            relay_fee: 2,
            protocol_fee: 3,
        }
    }

    #[test]
    fn chooses_smallest_input_arity_then_lowest_change() {
        let notes = fixture_notes(&[40, 60, 90, 105, 200]);
        let selection = NoteSelection::select(&notes, budget(100)).unwrap();
        assert_eq!(selection.input_indices, vec![3]);
        assert_eq!(selection.circuit_arity, 1);
        assert_eq!(selection.input_total, 105);
        assert_eq!(selection.change, 0);
        selection.verify(&notes, budget(100)).unwrap();

        let notes = fixture_notes(&[40, 60, 90]);
        let selection = NoteSelection::select(&notes, budget(100)).unwrap();
        assert_eq!(selection.input_indices, vec![0, 2]);
        assert_eq!(selection.circuit_arity, 2);
        assert_eq!(selection.change, 25);
    }

    #[test]
    fn supports_three_and_four_notes_with_four_input_circuit() {
        let notes = fixture_notes(&[20, 30, 55]);
        let selection = NoteSelection::select(&notes, budget(100)).unwrap();
        assert_eq!(selection.input_indices.len(), 3);
        assert_eq!(selection.circuit_arity, 4);
        assert_eq!(selection.change, 0);

        let notes = fixture_notes(&[20, 25, 30, 35]);
        let selection = NoteSelection::select(&notes, budget(105)).unwrap();
        assert_eq!(selection.input_indices.len(), 4);
        assert_eq!(selection.circuit_arity, 4);
        assert_eq!(selection.change, 0);
    }

    #[test]
    fn rejects_insufficient_fragmented_and_overflowing_balances() {
        assert_eq!(
            NoteSelection::select(&fixture_notes(&[10, 20, 30, 40]), budget(100)),
            Err(Error::InsufficientPrivateBalance)
        );
        let too_many = fixture_notes(&vec![1; MAX_SELECTION_CANDIDATES + 1]);
        assert_eq!(
            NoteSelection::select(&too_many, budget(1)),
            Err(Error::TooManySpendableNotes)
        );
        assert_eq!(
            TransferBudget {
                recipient: AtomicUsdc::new(crate::MAX_ATOMIC_USDC).unwrap(),
                relay_fee: i128::MAX,
                protocol_fee: 0,
            }
            .total(),
            Err(Error::AmountOverflow)
        );
    }

    #[test]
    fn detects_tampered_selection() {
        let notes = fixture_notes(&[105]);
        let mut selection = NoteSelection::select(&notes, budget(100)).unwrap();
        selection.change = 1;
        assert_eq!(
            selection.verify(&notes, budget(100)),
            Err(Error::ValueConservation)
        );
    }
}
