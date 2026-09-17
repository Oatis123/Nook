import { findAndReplace } from 'mdast-util-find-and-replace'
import type { Root, Text } from 'mdast'
import type { WikilinkIndex } from '@/features/notes/wikilinkIndex'

const WIKILINK_RE = /(!)?\[\[([^[\]]+)\]\]/g

function textNode(value: string, hName: string, hProperties: Record<string, unknown>): Text {
  return {
    type: 'text',
    value,
    data: {
      hName,
      hProperties,
      hChildren: [{ type: 'text', value }],
      // mdast's Data type doesn't declare these hast-extension fields; the cast below
      // keeps this file honest about that instead of loosening it project-wide.
    } as Text['data'],
  }
}

/** `[[Target]]`, `[[Target|Alias]]`, `[[Target#Heading]]`, `[[folder/Target]]`, and
 * `![[embed]]` (spec §6.3/§6.5). Resolution/click-navigation is done via plain <a>
 * elements the preview container handles through event delegation (see
 * MarkdownPreview's onClick), since hast/rehype-react props can't carry a JS handler. */
export function remarkWikilinks(index: WikilinkIndex) {
  return (tree: Root) => {
    findAndReplace(tree, [
      [
        WIKILINK_RE,
        (_match: string, bang: string | undefined, inner: string) => {
          const [targetPart, alias] = inner.split('|')
          const [target, heading] = targetPart.split('#')
          const trimmedTarget = target.trim()
          const label = (alias ?? targetPart).trim() || trimmedTarget

          if (bang) {
            return textNode(`\u{1F4CE} ${trimmedTarget}`, 'span', {
              className: ['wikilink-embed'],
            })
          }

          const resolved = index.resolve(trimmedTarget)
          const isAmbiguous = resolved === 'ambiguous'
          const isDangling = resolved === null

          return textNode(label, 'a', {
            ...(isDangling || isAmbiguous ? {} : { href: `/notes/${resolved.id}` }),
            className: isAmbiguous
              ? ['wikilink', 'wikilink-ambiguous']
              : isDangling
                ? ['wikilink', 'wikilink-dangling']
                : ['wikilink'],
            'data-wikilink': 'true',
            'data-wikilink-target': trimmedTarget,
            ...(heading?.trim() ? { 'data-wikilink-heading': heading.trim() } : {}),
            ...(isAmbiguous
              ? { title: `Ambiguous link — multiple notes named "${trimmedTarget}"` }
              : isDangling
                ? { title: `"${trimmedTarget}" doesn't exist yet — click to create it` }
                : {}),
          })
        },
      ],
    ])
  }
}
