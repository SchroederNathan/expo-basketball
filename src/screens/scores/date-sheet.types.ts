import type { Ymd } from '@/domain/dates';

export type DateSheetProps = {
  visible: boolean;
  value: Ymd;
  today: Ymd;
  onSelect: (date: Ymd) => void;
  onDismiss: () => void;
};
