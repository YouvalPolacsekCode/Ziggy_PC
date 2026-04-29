import { cn } from '../../lib/utils'

export function Select({ label, options = [], className, ...props }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</label>
      )}
      <select
        className={cn(
          'h-10 rounded-xl px-3 text-sm appearance-none',
          'bg-zinc-50 dark:bg-zinc-800',
          'border border-zinc-200 dark:border-zinc-700',
          'text-zinc-900 dark:text-zinc-100',
          'focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent',
          'transition-colors duration-150',
          className
        )}
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}
