import { PROJECT_URL } from '@/lib/site-settings'

export function ProjectAttribution() {
  return <a href={PROJECT_URL} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-foreground">Powered by Holly Music</a>
}
