import * as RadixSlider from '@radix-ui/react-slider'

// The one slider. 44px tall root so the whole strip is a comfortable touch
// target; 28px thumb (the iOS knob size) on the shared 8px .z-slider-track.
const THUMB = 28

export function Slider({ value, onValueChange, onValueCommit, min = 0, max = 100, step = 1, disabled, 'aria-label': ariaLabel }) {
  return (
    <RadixSlider.Root
      style={{
        position: 'relative', display: 'flex', alignItems: 'center',
        userSelect: 'none', touchAction: 'none', width: '100%', height: 44,
        opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
      }}
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
        aria-label={ariaLabel}
        style={{
          display: 'block', width: THUMB, height: THUMB,
          background: 'var(--surface)', borderRadius: '50%',
          border: '0.5px solid var(--line-2)',
          boxShadow: 'var(--shadow-md)',
          cursor: disabled ? 'not-allowed' : 'grab', outline: 'none',
          flexShrink: 0,
          transition: 'box-shadow var(--dur-press) var(--ease-standard)',
        }}
      />
    </RadixSlider.Root>
  )
}
