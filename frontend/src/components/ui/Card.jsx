import { cn } from '../../lib/utils'

export function Card({ className, children, onClick, ...props }) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-2xl bg-white dark:bg-zinc-900 shadow-sm dark:shadow-card-dark',
        'border border-zinc-200 dark:border-zinc-800',
        onClick && 'cursor-pointer hover:shadow-card-hover transition-shadow duration-200',
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
