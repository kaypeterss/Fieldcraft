import type { Battlefield } from '../domain/types'

export function BattlefieldSizeBadge({ battlefield }: { battlefield: Battlefield }) {
  return <div className="board-size-badge" aria-label="Battlefield size">
    <strong>{battlefield.width}</strong> × <strong>{battlefield.height}</strong> IN
  </div>
}
