import { paymentDeployment } from "@/lib/deployment";

export function NetworkStatus() {
  return paymentDeployment.ready ? (
    <div className="statusChip ready"><span />{paymentDeployment.deployment.environment} network ready</div>
  ) : (
    <div className="notice" role="status">
      <strong>Payment network setup required</strong>
      <p>{paymentDeployment.reason}</p>
    </div>
  );
}
