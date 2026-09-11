import * as RadixSlider from '@radix-ui/react-slider'

export function Slider({ value, onValueChange, onValueCommit, min = 0, max = 100, step = 1, disabled }) {
  return (
    <RadixSlider.Root
      style={{ position: 'relative', display: 'flex', alignItems: 'center', userSelect: 'none', touchAction: 'none', width: '100%', height: 20 }}
      value={[value]}
      onValueChange={onValueChange ? ([v]) => onValueChange(v) : undefined}
      onValueCommit={onValueCommit ? ([v]) => onValueCommit(v) : undefined}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
    >
      <RadixSlider.Track className="z-slider-track" style={{ flexGrow: 1 }}>
        <RadixSlider.Range className="z-slider-fill" />
      </RadixSlider.Track>
      <RadixSlider.Thumb
        style={{
          display: 'block', width: 18, height: 18,
          background: 'var(--surface)', borderRadius: '50%',
          border: '0.5px solid var(--line-2)',
          boxShadow: 'var(--shadow-md)',
          cursor: 'pointer', outline: 'none',
          flexShrink: 0,
        }}
      />
    </RadixSlider.Root>
  )
}
