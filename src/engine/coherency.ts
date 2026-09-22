import type { CoherencyPolicy, TabletopModel, Unit } from '../domain/types'
import type { Point } from './geometry/point'
import { closestPointsBetweenBases, isDistanceWithinRange } from './spatial'

export type { CoherencyPolicy } from '../domain/types'

export interface CoherencyModelResult {
  modelId: string
  neighborIds: string[]
  neighborCount: number
  valid: boolean
}

export interface CoherencyLink {
  sourceModelId: string
  targetModelId: string
  distance: number
  startAnchor: Point
  endAnchor: Point
}

export interface CoherencyResult {
  coherent: boolean
  neighborRequirementsSatisfied: boolean
  connected: boolean
  componentCount: number
  components: string[][]
  models: CoherencyModelResult[]
  links: CoherencyLink[]
}

export function evaluateUnitCoherency(
  unit: Unit,
  allModels: ReadonlyArray<TabletopModel>,
  policy: CoherencyPolicy,
): CoherencyResult {
  const byId = new Map(allModels.map((model) => [model.id, model]))
  const models = unit.modelIds.flatMap((id) => {
    const model = byId.get(id)
    return model ? [model] : []
  })
  const neighbors = new Map(models.map((model) => [model.id, [] as string[]]))
  const links: CoherencyLink[] = []

  for (let sourceIndex = 0; sourceIndex < models.length; sourceIndex += 1) {
    for (let targetIndex = sourceIndex + 1; targetIndex < models.length; targetIndex += 1) {
      const source = models[sourceIndex]
      const target = models[targetIndex]
      const closest = closestPointsBetweenBases(source, target)
      if (!isDistanceWithinRange(closest.distance, policy.distance)) continue
      neighbors.get(source.id)?.push(target.id)
      neighbors.get(target.id)?.push(source.id)
      links.push({
        sourceModelId: source.id,
        targetModelId: target.id,
        distance: closest.distance,
        startAnchor: closest.startAnchor,
        endAnchor: closest.endAnchor,
      })
    }
  }

  const requiredNeighbors = Math.max(0, Math.floor(policy.requiredNeighbors))
  const modelResults = models.map((model) => {
    const neighborIds = neighbors.get(model.id) ?? []
    return {
      modelId: model.id,
      neighborIds,
      neighborCount: neighborIds.length,
      valid: neighborIds.length >= requiredNeighbors,
    }
  })

  const neighborRequirementsSatisfied = modelResults.every((model) => model.valid)
  const components = connectedComponents(models.map((model) => model.id), neighbors)
  const connected = components.length <= 1

  return {
    coherent: neighborRequirementsSatisfied && (!policy.requireConnected || connected),
    neighborRequirementsSatisfied,
    connected,
    componentCount: components.length,
    components,
    models: modelResults,
    links,
  }
}

export function isCoherencyResultValid(result: CoherencyResult, policy: CoherencyPolicy): boolean {
  return result.neighborRequirementsSatisfied && (!policy.requireConnected || result.connected)
}

function connectedComponents(modelIds: string[], neighbors: ReadonlyMap<string, string[]>): string[][] {
  const unvisited = new Set(modelIds)
  const components: string[][] = []
  for (const modelId of modelIds) {
    if (!unvisited.has(modelId)) continue
    const component: string[] = []
    const pending = [modelId]
    while (pending.length > 0) {
      const current = pending.pop()
      if (!current || !unvisited.delete(current)) continue
      component.push(current)
      for (const neighbor of neighbors.get(current) ?? []) {
        if (unvisited.has(neighbor)) pending.push(neighbor)
      }
    }
    components.push(component.sort((left, right) => left.localeCompare(right)))
  }
  return components
}
