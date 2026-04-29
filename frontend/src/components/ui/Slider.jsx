import * as RadixSlider from '@radix-ui/react-slider'
import { cn } from '../../lib/utils'

export function Slider({ value, onValueChange, onValueCommit, min = 0, max = 100, step = 1, className }) {
  return (
    <RadixSlider.Root
      className={cn('relative flex items-center select-none touch-none w-full h-5', className)}
      value={[value]}
      onValueChange={onValueChange ? ([v]) => onValueChange(v) : undefined}
      onValueCommit={onValueCommit ? ([v]) => onValueCommit(v) : undefined}
      min={min}
      max={max}
      step={step}
    >
      <RadixSlider.Track className="bg-zinc-200 dark:bg-zinc-700 relative grow rounded-full h-1.5">
        <RadixSlider.Range className="absolute bg-violet-600 rounded-full h-full" />
      </RadixSlider.Track>
      <RadixSlider.Thumb
        className="block w-4 h-4 bg-white rounded-full shadow-md border border-zinc-200 dark:border-zinc-600 cursor-pointer focus:outline-none focus:ring-2 focus:ring-violet-500"
      />
    </RadixSlider.Root>
  )
}
