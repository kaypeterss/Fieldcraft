import type { TabletopModel, Unit } from '../domain/types'
import { distanceBetweenBases, isDistanceWithinRange } from './spatial'

export interface CoherencyPolicy {
  distance: number
  requiredNeighbors: number
}

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
}

export interface CoherencyResult {
  coherent: boolean
  connected: boolean
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
      const distance = distanceBetweenBases(source, target)
      if (!isDistanceWithinRange(distance, policy.distance)) continue
      neighbors.get(source.id)?.push(target.id)
      neighbors.get(target.id)?.push(source.id)
      links.push({ sourceModelId: source.id, targetModelId: target.id, distance })
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

  return {
    coherent: modelResults.every((model) => model.valid),
    connected: isConnected(models.map((model) => model.id), neighbors),
    models: modelResults,
    links,
  }
}

function isConnected(modelIds: string[], neighbors: ReadonlyMap<string, string[]>): boolean {
  if (modelIds.length <= 1) return true
  const visited = new Set<string>()
  const pending = [modelIds[0]]
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current || visited.has(current)) continue
    visited.add(current)
    for (const neighbor of neighbors.get(current) ?? []) {
      if (!visited.has(neighbor)) pending.push(neighbor)
    }
  }
  return visited.size === modelIds.length
}
