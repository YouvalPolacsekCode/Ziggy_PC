import { cn } from '../../lib/utils'

export function Input({ className, label, error, ...props }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {label}
        </label>
      )}
      <input
        className={cn(
          'h-10 rounded-xl px-3 text-sm',
          'bg-zinc-50 dark:bg-zinc-800',
          'border border-zinc-200 dark:border-zinc-700',
          'text-zinc-900 dark:text-zinc-100',
          'placeholder:text-zinc-400 dark:placeholder:text-zinc-600',
          'transition-colors duration-150',
          'focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent',
          error && 'border-red-400 focus:ring-red-400',
          className
        )}
        {...props}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}

export function Textarea({ className, label, error, ...props }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {label}
        </label>
      )}
      <textarea
        className={cn(
          'rounded-xl px-3 py-2.5 text-sm resize-none',
          'bg-zinc-50 dark:bg-zinc-800',
          'border border-zinc-200 dark:border-zinc-700',
          'text-zinc-900 dark:text-zinc-100',
          'placeholder:text-zinc-400 dark:placeholder:text-zinc-600',
          'transition-colors duration-150',
          'focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent',
          error && 'border-red-400 focus:ring-red-400',
          className
        )}
        {...props}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
