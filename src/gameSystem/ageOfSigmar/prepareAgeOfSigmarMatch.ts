import type { BattlefieldFeature, GameState, TabletopModel, Unit, UnitDefinition } from '../../domain/types'
import { whatsYoursIsOurs } from './content/battleplans/whatsYoursIsOurs'
import { stormcastTestRoster, skavenTestRoster } from './content/rosters/testRosters'
import { stormcastWarscrolls } from './content/warscrolls/stormcast'
import { skavenWarscrolls } from './content/warscrolls/skaven'
import type { AosRoster, AosWarscrollProfile } from './content/types'
import { initialAosDeploymentState } from './deployment'

const profiles = new Map([...stormcastWarscrolls, ...skavenWarscrolls].map((profile) => [profile.id, profile]))

export function prepareAgeOfSigmarMatch(state: GameState): GameState {
  if (state.matchIdentity?.gameSystem.id !== 'age-of-sigmar') throw new Error('Only an Age of Sigmar match can use this setup.')
  const stormcast = projectRoster(stormcastTestRoster, 'player-1')
  const skaven = projectRoster(skavenTestRoster, 'player-2')
  return {
    ...state,
    matchLifecycle: 'DEPLOYMENT',
    battlefield: { ...whatsYoursIsOurs.battlefield },
    battlefieldFeatures: [...objectiveFeatures(), ...terrainFeatures()],
    terrainPolicy: { defaultBase: { canEnter: true, canCross: true, canFinish: true }, defaultObject: { canEnter: false, canCross: false, canFinish: false }, rules: [] },
    resolvedMatchConfiguration: {
      id: whatsYoursIsOurs.id, version: whatsYoursIsOurs.version, roundLimit: whatsYoursIsOurs.roundLimit,
      objectiveFeatureIds: whatsYoursIsOurs.objectives.map((objective) => `aos-objective-${objective.id}`),
      deploymentZones: [
        { id: 'attacker-territory', name: 'Territory A', ownerRole: 'attacker', areas: whatsYoursIsOurs.territories.filter((area) => area.id.startsWith('attacker')).map((area) => ({ vertices: area.vertices.map((point) => ({ ...point })) })) },
        { id: 'defender-territory', name: 'Territory B', ownerRole: 'defender', areas: whatsYoursIsOurs.territories.filter((area) => area.id.startsWith('defender')).map((area) => ({ vertices: area.vertices.map((point) => ({ ...point })) })) },
      ],
      policyReferences: { battlepack: 'generals-handbook/2026-27', battleplan: 'whats-yours-is-ours/2026-27' },
    },
    models: [...stormcast.models, ...skaven.models], units: [...stormcast.units, ...skaven.units],
    unitDefinitions: [...stormcast.definitions, ...skaven.definitions],
    gameSystemState: {
      schemaId: 'fieldcraft.age-of-sigmar.alpha-match-state',
      schemaVersion: 1,
      data: { status: 'deployment', setup: aosSetupData(), deployment: initialAosDeploymentState() } as unknown as import('../../domain/types').JsonValue,
    },
  }
}

export function aosSetupData() {
  return { battlepackId: 'generals-handbook', battleplanId: whatsYoursIsOurs.id,
    playerRosters: [{ playerId: 'player-1', rosterId: stormcastTestRoster.id }, { playerId: 'player-2', rosterId: skavenTestRoster.id }] }
}

function projectRoster(roster: AosRoster, ownerId: string): { models: TabletopModel[]; units: Unit[]; definitions: UnitDefinition[] } {
  const models: TabletopModel[] = []; const units: Unit[] = []; const definitions: UnitDefinition[] = []
  for (const rosterUnit of roster.units) {
    const profile = profiles.get(rosterUnit.warscrollId)
    if (!profile) throw new Error(`Missing AoS warscroll ${rosterUnit.warscrollId}.`)
    const definitionId = `aos-${profile.id}`; const modelIds: string[] = []
    for (let index = 0; index < profile.unitSize; index += 1) {
      const id = `${rosterUnit.id}-${index + 1}`; modelIds.push(id)
      models.push({ id, unitId: rosterUnit.id, ownerId, position: { x: 0, y: 0 }, rotation: 0,
        base: structuredClone(profile.footprint), canPassOverModels: false, objectiveControl: profile.control,
        keywords: [...profile.keywords], label: `${rosterUnit.displayName} ${index + 1}`, presence: 'OFF_BOARD' })
    }
    units.push({ id: rosterUnit.id, ownerId, definitionId, modelIds })
    definitions.push(definitionFor(profile, definitionId))
  }
  return { models, units, definitions }
}
function definitionFor(profile: AosWarscrollProfile, id: string): UnitDefinition {
  return { id, name: profile.name, movementAllowance: profile.move, objectiveControl: profile.control,
    keywords: [...profile.keywords], coherencyPolicy: {
      distance: 0.5,
      requiredNeighbors: profile.unitSize === 1 ? 0 : profile.unitSize >= 7 ? 2 : 1,
      requireConnected: true,
    } }
}
function objectiveFeatures(): BattlefieldFeature[] {
  const controlDiameterMm = 40 + (6 * 25.4)
  return whatsYoursIsOurs.objectives.map((objective) => ({ id: `aos-objective-${objective.id}`, name: objective.name,
    pose: { position: { x: objective.x, y: objective.y }, rotation: 0 }, baseArea: { shape: 'circle', diameterMm: 40 },
    capabilities: { objective: { type: 'objective', area: { type: 'local-footprint', footprint: { shape: 'circle', diameterMm: controlDiameterMm }, localPose: { position: { x: 0, y: 0 }, rotation: 0 } } } }, objects: [] }))
}
function terrainFeatures(): BattlefieldFeature[] {
  return whatsYoursIsOurs.terrainLocations.map((location) => {
    const obstacle = location.kind === 'obstacle'
    return { id: `aos-terrain-${location.id}`, name: location.id.split('-').map(capitalize).join(' '),
      pose: { position: { x: location.x, y: location.y }, rotation: 0 },
      baseArea: obstacle ? { shape: 'rectangle' as const, widthMm: 101.6, heightMm: 50.8 } : { shape: 'ellipse' as const, widthMm: 127, heightMm: 76.2 },
      capabilities: { terrain: { type: 'terrain' as const } },
      objects: obstacle ? [{ id: 'wall', name: 'Blocking Wall', footprint: { shape: 'rectangle' as const, widthMm: 101.6, heightMm: 12.7 }, localPose: { position: { x: 0, y: 0 }, rotation: 0 } }] : [] }
  })
}
function capitalize(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1) }
