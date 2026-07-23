const CONTRACT = /^C[A-Z2-7]{55}$/u;

export function resolveArchiveVault(
  configured: string | undefined,
  deploymentVault: string | undefined,
): string {
  const vault = configured || deploymentVault;
  if (!vault || !CONTRACT.test(vault)) {
    throw new Error("Private activity sync vault is not configured");
  }
  return vault;
}
