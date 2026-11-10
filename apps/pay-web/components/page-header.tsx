import { StepHeading } from "./step-heading";

export function PageHeader({ title, description }: { title: string; description?: string }) {
  return <header className="pageHeader"><StepHeading>{title}</StepHeading>{description && <p className="muted">{description}</p>}</header>;
}
