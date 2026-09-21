import type { GameState, TabletopModel } from '../domain/types'
import { distanceBetween, type Point } from '../engine/geometry/point'
import {
  closestPointsBetweenBases,
  closestPointsFromBaseToPoint,
  minimumDistanceBetweenUnits,
  minimumDistanceFromUnitToPoint,
} from '../engine/spatial'

export type MeasurementTarget =
  | { type: 'point'; point: Point }
  | { type: 'model'; modelId: string }
  | { type: 'unit'; unitId: string }

export interface MeasurementPair {
  targetA: MeasurementTarget
  targetB: MeasurementTarget
}

export interface MeasurementResult extends MeasurementPair {
  distanceInches: number
  startAnchor: Point
  endAnchor: Point
  sourceModelId?: string
  targetModelId?: string
}

export function measureBetweenTargets(
  state: Pick<GameState, 'models' | 'units'>,
  targetA: MeasurementTarget,
  targetB: MeasurementTarget,
): MeasurementResult | null {
  if (targetA.type === 'point' && targetB.type === 'point') {
    return result(targetA, targetB, distanceBetween(targetA.point, targetB.point), targetA.point, targetB.point)
  }

  if (targetA.type === 'model' && targetB.type === 'point') {
    const model = findModel(state, targetA.modelId)
    if (!model) return null
    const closest = closestPointsFromBaseToPoint(model, targetB.point)
    return result(targetA, targetB, closest.distance, closest.startAnchor, closest.endAnchor, model.id)
  }

  if (targetA.type === 'point' && targetB.type === 'model') {
    const model = findModel(state, targetB.modelId)
    if (!model) return null
    const closest = closestPointsFromBaseToPoint(model, targetA.point)
    return result(targetA, targetB, closest.distance, closest.endAnchor, closest.startAnchor, undefined, model.id)
  }

  if (targetA.type === 'model' && targetB.type === 'model') {
    const source = findModel(state, targetA.modelId)
    const target = findModel(state, targetB.modelId)
    if (!source || !target) return null
    const closest = closestPointsBetweenBases(source, target)
    return result(targetA, targetB, closest.distance, closest.startAnchor, closest.endAnchor, source.id, target.id)
  }

  const modelsA = resolveModels(state, targetA)
  const modelsB = resolveModels(state, targetB)

  if (targetA.type !== 'point' && targetB.type !== 'point') {
    if (!modelsA || !modelsB) return null
    const closest = minimumDistanceBetweenUnits(modelsA, modelsB)
    return closest ? result(
      targetA,
      targetB,
      closest.distance,
      closest.startAnchor,
      closest.endAnchor,
      closest.sourceModelId,
      closest.targetModelId,
    ) : null
  }

  if (targetA.type === 'unit' && targetB.type === 'point') {
    if (!modelsA) return null
    const closest = minimumDistanceFromUnitToPoint(modelsA, targetB.point)
    return closest ? result(
      targetA,
      targetB,
      closest.distance,
      closest.modelAnchor,
      closest.pointAnchor,
      closest.modelId,
    ) : null
  }

  if (targetA.type === 'point' && targetB.type === 'unit') {
    if (!modelsB) return null
    const closest = minimumDistanceFromUnitToPoint(modelsB, targetA.point)
    return closest ? result(
      targetA,
      targetB,
      closest.distance,
      closest.pointAnchor,
      closest.modelAnchor,
      undefined,
      closest.modelId,
    ) : null
  }

  return null
}

function findModel(state: Pick<GameState, 'models'>, modelId: string): TabletopModel | undefined {
  return state.models.find((model) => model.id === modelId)
}

function resolveModels(
  state: Pick<GameState, 'models' | 'units'>,
  target: MeasurementTarget,
): TabletopModel[] | null {
  if (target.type === 'point') return null
  if (target.type === 'model') {
    const model = findModel(state, target.modelId)
    return model ? [model] : null
  }
  const unit = state.units.find((candidate) => candidate.id === target.unitId)
  if (!unit) return null
  const byId = new Map(state.models.map((model) => [model.id, model]))
  const models = unit.modelIds.flatMap((modelId) => {
    const model = byId.get(modelId)
    return model ? [model] : []
  })
  return models.length > 0 ? models : null
}

function result(
  targetA: MeasurementTarget,
  targetB: MeasurementTarget,
  distanceInches: number,
  startAnchor: Point,
  endAnchor: Point,
  sourceModelId?: string,
  targetModelId?: string,
): MeasurementResult {
  return {
    targetA,
    targetB,
    distanceInches,
    startAnchor: { ...startAnchor },
    endAnchor: { ...endAnchor },
    ...(sourceModelId ? { sourceModelId } : {}),
    ...(targetModelId ? { targetModelId } : {}),
  }
}
