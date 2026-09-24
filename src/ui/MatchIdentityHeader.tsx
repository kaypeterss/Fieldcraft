import type { GameSystemUiContribution } from '../gameSystem/registry'

export function MatchIdentityHeader({ gameSystemName, matchName, ui }: {
  gameSystemName: string
  matchName?: string
  ui: GameSystemUiContribution
}) {
  const systemLabel = ui.shell?.shortName ?? gameSystemName
  return <section className="match-identity" aria-label="Match identity">
    <strong>{systemLabel}</strong>
    <span>{ui.shell?.missionName ?? matchName ?? 'Open Match'}</span>
    {ui.shell?.formatName && <small>{ui.shell.formatName}</small>}
  </section>
}
