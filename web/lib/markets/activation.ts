export type ActivationStage = "registration" | "listing";

export async function activateMarket({
  register,
  save,
  onStage,
}: {
  register: () => Promise<void>;
  save: () => Promise<boolean>;
  onStage: (stage: ActivationStage) => void;
}): Promise<void> {
  onStage("registration");
  await register();
  onStage("listing");
  if (!(await save())) {
    throw new Error("The market contracts and committee are ready, but the public registry rejected the listing. Retry market setup to publish it.");
  }
}
