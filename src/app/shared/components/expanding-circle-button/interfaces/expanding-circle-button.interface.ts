export interface ExpandingButtonOption {
  id: string;
  label: string;
  color: string;
  icon?: string;
  description?: string;
}

export interface RippleEffect {
  x: number;
  y: number;
  size: number;
  optionId: string;
  id: number;
}
