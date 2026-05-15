import * as Switch from '@radix-ui/react-switch'

export function Toggle({ checked, onCheckedChange, disabled, className }) {
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={className}
      style={{
        position: 'relative', display: 'inline-flex', alignItems: 'center',
        width: 36, height: 20, borderRadius: 999, border: 'none', padding: 0,
        background: checked ? 'var(--ok)' : 'var(--line-2)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background 0.15s',
        flexShrink: 0,
      }}
    >
      <Switch.Thumb
        style={{
          display: 'block', width: 16, height: 16, borderRadius: '50%',
          background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          transition: 'transform 0.15s',
          transform: checked ? 'translateX(18px)' : 'translateX(2px)',
        }}
      />
    </Switch.Root>
  )
}
