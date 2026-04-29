import * as Switch from '@radix-ui/react-switch'
import { cn } from '../../lib/utils'

export function Toggle({ checked, onCheckedChange, disabled, className }) {
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full',
        'transition-colors duration-200 ease-in-out',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        checked ? 'bg-violet-600' : 'bg-zinc-200 dark:bg-zinc-700',
        className
      )}
    >
      <Switch.Thumb
        className={cn(
          'pointer-events-none block h-5 w-5 rounded-full bg-white shadow',
          'transition-transform duration-200 ease-in-out',
          checked ? 'translate-x-[22px]' : 'translate-x-[2px]'
        )}
      />
    </Switch.Root>
  )
}
