import * as RadixSlider from '@radix-ui/react-slider'

export function Slider({ value, onValueChange, onValueCommit, min = 0, max = 100, step = 1 }) {
  return (
    <RadixSlider.Root
      style={{ position: 'relative', display: 'flex', alignItems: 'center', userSelect: 'none', touchAction: 'none', width: '100%', height: 20 }}
      value={[value]}
      onValueChange={onValueChange ? ([v]) => onValueChange(v) : undefined}
      onValueCommit={onValueCommit ? ([v]) => onValueCommit(v) : undefined}
      min={min}
      max={max}
      step={step}
    >
      <RadixSlider.Track style={{ background: 'var(--line-2)', position: 'relative', flexGrow: 1, borderRadius: 999, height: 4 }}>
        <RadixSlider.Range style={{ position: 'absolute', background: 'var(--ink)', borderRadius: 999, height: '100%' }} />
      </RadixSlider.Track>
      <RadixSlider.Thumb
        style={{
          display: 'block', width: 16, height: 16,
          background: '#fff', borderRadius: '50%',
          border: '0.5px solid var(--line-2)',
          boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
          cursor: 'pointer', outline: 'none',
        }}
      />
    </RadixSlider.Root>
  )
}
