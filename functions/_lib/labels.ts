import type { Label, LabelColor } from '../../shared/types'

export interface LabelRow {
  id: string
  name: string
  color: string
  created_at: string
}

export function toLabel(row: LabelRow): Label {
  return {
    id: row.id,
    name: row.name,
    color: row.color as LabelColor,
    createdAt: row.created_at,
  }
}
