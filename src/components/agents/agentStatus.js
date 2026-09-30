// Status values mirror STATUS_COLORS in AgentsPage — shared by the List, Map,
// and Birthdays tabs so the same status checkboxes filter all three.
export const STATUSES = ['Active', 'Stalled', 'Lapsed', 'Terminated']
export const NO_STATUS = 'No status'

export const STATUS_HEX = {
  Active:     '#22c55e',
  Stalled:    '#facc15',
  Lapsed:     '#f59e0b',
  Terminated: '#ef4444',
  [NO_STATUS]: '#9ca3af',
}

export function statusOf(p) {
  return STATUSES.includes(p.status) ? p.status : NO_STATUS
}
