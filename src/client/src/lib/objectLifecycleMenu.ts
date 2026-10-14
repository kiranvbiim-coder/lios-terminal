import {
  getLifecycleActions,
  type LifecycleAction,
  type LifecycleActionDescriptor,
  type LifecycleTarget,
} from "@shared/objectLifecycle";

export interface LifecycleMenuOptions {
  hidden?: LifecycleAction[];
  disabled?: Partial<Record<LifecycleAction, string>>;
}

export interface LifecycleMenuItem extends LifecycleActionDescriptor {
  disabledReason?: string;
}

export function getLifecycleMenuItems(
  target: LifecycleTarget,
  options: LifecycleMenuOptions = {},
): LifecycleMenuItem[] {
  const hidden = new Set(options.hidden ?? []);
  return getLifecycleActions(target)
    .filter((item) => !hidden.has(item.id))
    .map((item) => ({
      ...item,
      ...(options.disabled?.[item.id] ? { disabledReason: options.disabled[item.id] } : {}),
    }));
}
