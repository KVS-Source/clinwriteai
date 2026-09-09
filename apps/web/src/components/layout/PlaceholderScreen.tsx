interface Props { name: string }

export function PlaceholderScreen({ name }: Props) {
  return (
    <div className="flex h-full items-center justify-center p-12">
      <div className="text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-slate-400">
          Placeholder
        </p>
        <h2 className="mt-2 text-xl font-bold text-slate-700">{name}</h2>
        <p className="mt-1 text-sm text-slate-400">
          Built in a later session
        </p>
      </div>
    </div>
  )
}
