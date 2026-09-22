import type { MovementPolicyConfig } from '../domain/types'

interface MovementCostPolicyPanelProps {
  policy: MovementPolicyConfig
  disabled: boolean
  onChange: (policy: MovementPolicyConfig) => void
}

export function MovementCostPolicyPanel({
  policy,
  disabled,
  onChange,
}: MovementCostPolicyPanelProps) {
  return (
    <aside className="movement-policy-panel">
      <label>
        <span>Prototype movement policy</span>
        <select
          aria-label="Movement policy"
          value={policy.type}
          disabled={disabled}
          onChange={(event) => {
            const type = event.target.value as MovementPolicyConfig['type']
            onChange(type === 'fixed-rotation-charge'
              ? { type, rotationCharge: 2 }
              : { type })
          }}
        >
          <option value="movement-envelope">Movement envelope</option>
          <option value="fixed-rotation-charge">Fixed rotation charge</option>
          <option value="free-rotation">Free rotation</option>
        </select>
      </label>
      {policy.type === 'fixed-rotation-charge' && (
        <label className="movement-policy-charge">
          <span>Charge</span>
          <span className="number-input-wrap">
            <input
              aria-label="Fixed rotation charge"
              type="number"
              min="0"
              step="0.25"
              value={policy.rotationCharge}
              disabled={disabled}
              onChange={(event) => {
                const rotationCharge = Number(event.target.value)
                if (Number.isFinite(rotationCharge) && rotationCharge >= 0) {
                  onChange({ type: policy.type, rotationCharge })
                }
              }}
            />
            <small>IN</small>
          </span>
        </label>
      )}
      <small>{disabled ? 'Locked for the active move' : 'Debug policy · applies to the next move'}</small>
    </aside>
  )
}
