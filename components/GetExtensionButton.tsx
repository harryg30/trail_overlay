'use client'

import { Puzzle } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const webstoreUrl = process.env.NEXT_PUBLIC_CHROME_WEBSTORE_URL?.trim() ?? ''

export default function GetExtensionButton() {
  // Only show button if Chrome Web Store URL is configured
  if (!webstoreUrl) {
    return null
  }

  return (
    <a
      href={webstoreUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        buttonVariants({ variant: 'catalog', size: 'sm' }),
        'w-full justify-center gap-2 whitespace-normal text-center'
      )}
    >
      <Puzzle className="size-4 shrink-0" aria-hidden />
      Get extension
    </a>
  )
}
