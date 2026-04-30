import { cn } from '../../lib/utils'

export function Card({ className, children, onClick, ...props }) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-2xl bg-white dark:bg-zinc-900',
        'border border-zinc-200/80 dark:border-zinc-700/50',
        'shadow-sm dark:shadow-[0_2px_16px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.04)]',
        onClick && 'cursor-pointer hover:shadow-card-hover dark:hover:border-zinc-600/60 transition-all duration-200',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function CardHeader({ className, children }) {
  return (
    <div className={cn('px-4 pt-4 pb-2 flex items-center justify-between', className)}>
      {children}
    </div>
  )
}

export function CardBody({ className, children }) {
  return <div className={cn('px-4 pb-4', className)}>{children}</div>
}
