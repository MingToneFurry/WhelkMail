import type { Label, LabelColor } from '../../shared/types'

export interface LabelRow {
  id: string
  account_id: string | null
  name: string
  color: string
  created_at: string
}

export const LABEL_COLOR_IDS: LabelColor[] = [
  'blue',
  'emerald',
  'amber',
  'violet',
  'rose',
  'cyan',
  'lime',
]

export function toLabel(row: LabelRow): Label {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    color: row.color as LabelColor,
    createdAt: row.created_at,
  }
}
