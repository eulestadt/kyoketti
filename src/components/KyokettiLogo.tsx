type LogoProps = {
  className?: string
  title?: string
}

export function KyokettiLogo({ className, title = 'Kyoketti' }: LogoProps) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <rect x="14" y="10" width="36" height="44" rx="6" stroke="currentColor" strokeWidth="2.5" />
      <path
        d="M14 20h-4.5M14 29h-4.5M14 38h-4.5M14 47h-4.5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M27 20v24M27 32l14-12M27 32l14 12"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
