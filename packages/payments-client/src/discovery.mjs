const MAX_SCAN_OUTPUTS = 5_000;

function integer(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

export class PaymentOutputScanner {
  constructor({ client, deployment, checkpoint = 0, saveCheckpoint = async () => {} }) {
    if (!client || typeof client.outputs !== "function") throw new Error("payment client is required");
    if (typeof saveCheckpoint !== "function") throw new Error("payment checkpoint store is required");
    this.client = client;
    this.deployment = deployment;
    this.checkpoint = integer(checkpoint, 0, 2 ** 31 - 1, "payment output checkpoint");
    this.saveCheckpoint = saveCheckpoint;
    this.scanPending = null;
    this.commitments = new Set();
  }

  scan({ decrypt, signal, pageSize = 100 } = {}) {
    if (typeof decrypt !== "function") throw new Error("payment output decryptor is required");
    if (!this.scanPending) {
      this.scanPending = this.scanCurrent({ decrypt, signal, pageSize }).finally(() => {
        this.scanPending = null;
      });
    }
    return this.scanPending;
  }

  async scanCurrent({ decrypt, signal, pageSize }) {
    integer(pageSize, 1, 500, "payment scan page size");
    let scanned = 0;
    const notes = [];
    do {
      if (signal?.aborted) throw signal.reason || new Error("payment scan aborted");
      const page = await this.client.outputs(
        { fromLeafIndex: this.checkpoint, limit: pageSize },
        { signal },
      );
      if (
        page.network !== this.deployment.network ||
        page.vault !== this.deployment.vault ||
        page.fromLeafIndex !== this.checkpoint ||
        typeof page.hasMore !== "boolean" ||
        !Array.isArray(page.outputs) ||
        page.outputs.length > pageSize ||
        page.nextLeafIndex !== this.checkpoint + page.outputs.length
      ) {
        throw new Error("payment output page does not match this deployment");
      }
      const pageCommitments = new Set();
      const pageNotes = [];
      for (let index = 0; index < page.outputs.length; index++) {
        const output = page.outputs[index];
        if (output.leafIndex !== this.checkpoint + index) throw new Error("payment output page contains a gap");
        if (this.commitments.has(output.commitment) || pageCommitments.has(output.commitment)) {
          throw new Error("duplicate payment output commitment");
        }
        pageCommitments.add(output.commitment);
        const note = await decrypt(output);
        if (note) pageNotes.push({ output, note });
      }
      const next = page.nextLeafIndex;
      await this.saveCheckpoint(next);
      this.checkpoint = next;
      pageCommitments.forEach((commitment) => this.commitments.add(commitment));
      notes.push(...pageNotes);
      scanned += page.outputs.length;
      if (scanned > MAX_SCAN_OUTPUTS) throw new Error("payment scan limit exceeded");
      if (!page.hasMore) break;
      if (page.outputs.length === 0) throw new Error("payment output cursor did not advance");
    } while (true);
    return { checkpoint: this.checkpoint, scanned, notes };
  }
}
