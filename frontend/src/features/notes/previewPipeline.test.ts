import { describe, expect, it } from 'vitest'
import { createPreviewRenderer } from '@/features/notes/previewPipeline'

const context = { theme: 'light' as const, notes: [], folders: [], attachments: [] }

describe('preview blocks', () => {
  it('sends back only the blocks that changed, wherever they moved', async () => {
    const renderer = createPreviewRenderer()
    renderer.setContext(context)

    const first = await renderer.render('# Title\n\nOne\n\nTwo\n\nThree', new Set())
    const firstKeys = first.keys.filter((key) => first.blocks[key]?.type === 'element')
    expect(firstKeys).toHaveLength(4)

    // Edit "Two" and add a paragraph above everything: positions shift for every block.
    const second = await renderer.render(
      'New\n\n# Title\n\nOne\n\nTwo edited\n\nThree',
      new Set(first.keys),
    )
    const sent = Object.values(second.blocks).filter((b) => b.type === 'element')
    expect(sent.map((b) => (b.type === 'element' ? b.children : null))).toEqual([
      [{ type: 'text', value: 'New' }],
      [{ type: 'text', value: 'Two edited' }],
    ])
    // The untouched blocks keep their keys, so the preview reuses them as they are.
    expect(second.keys).toEqual(expect.arrayContaining([firstKeys[0], firstKeys[1], firstKeys[3]]))
  })

  it('renders notes without code without loading the highlighter', async () => {
    const renderer = createPreviewRenderer()
    renderer.setContext(context)
    const result = await renderer.render('Plain *text* and `inline code`', new Set())
    const html = JSON.stringify(result.blocks)
    expect(html).toContain('"tagName":"code"')
    expect(html).not.toContain('"style"')
  })

  it('renders formulas with KaTeX, inline and display, next to highlighted code', async () => {
    const renderer = createPreviewRenderer()
    renderer.setContext(context)
    const result = await renderer.render(
      String.raw`Euler: $e^{i\pi} + 1 = 0$` +
        '\n\n$$\n' +
        String.raw`\int_0^1 x^2\,dx = \frac{1}{3}` +
        '\n$$\n\n```js\nlet a = 1\n```',
      new Set(),
    )
    expect(result.math).toBe(true)
    const html = JSON.stringify(result.blocks)
    expect(html).toContain('"katex"')
    expect(html).toContain('"math-display"')
    expect(html).toContain('"katex-display"')
    // The display formula isn't taken for a code block by the highlighter…
    expect(html).not.toContain('int_0^1 x^2')
    // …while the real one is still highlighted.
    expect(html).toMatch(/"style":"color:#[0-9A-Fa-f]{6}"/)
  })

  it('keeps dollar amounts as text', async () => {
    const renderer = createPreviewRenderer()
    renderer.setContext(context)
    const result = await renderer.render('It cost $5 and $10, or $ 3 $ more', new Set())
    expect(result.math).toBe(false)
    const html = JSON.stringify(result.blocks)
    expect(html).not.toContain('katex')
    expect(html).toContain('$5 and $')
    expect(html).toContain('$ 3 $')
  })

  it('shows a broken formula as its source instead of failing the note', async () => {
    const renderer = createPreviewRenderer()
    renderer.setContext(context)
    const result = await renderer.render(String.raw`Oops: $\frac{1}{$ and fine`, new Set())
    const html = JSON.stringify(result.blocks)
    expect(html).toContain('katex-error')
    expect(html).toContain('and fine')
  })

  it('wraps task items so a done one can be struck through without its sub-list', async () => {
    const renderer = createPreviewRenderer()
    renderer.setContext(context)
    const result = await renderer.render('- [x] Done\n  - [ ] Nested\n- [ ] Open', new Set())
    const list = Object.values(result.blocks).find(
      (block) => block.type === 'element' && block.tagName === 'ul',
    )
    const items = JSON.parse(JSON.stringify(list)).children.filter(
      (child: { tagName?: string }) => child.tagName === 'li',
    )
    expect(items[0].properties.className).toEqual(['task-list-item', 'task-list-item-checked'])
    expect(items[1].properties.className).toEqual(['task-list-item'])
    const label = items[0].children.find((child: { tagName?: string }) => child.tagName === 'span')
    expect(label.properties.className).toEqual(['task-list-label'])
    expect(label.children).toEqual([{ type: 'text', value: 'Done' }])
    // The nested list stays outside the label.
    expect(items[0].children.some((child: { tagName?: string }) => child.tagName === 'ul')).toBe(
      true,
    )
  })

  it("finds each checkbox's marker in the source, in page order", async () => {
    const renderer = createPreviewRenderer()
    renderer.setContext(context)
    const source = [
      'Intro [x] not a task',
      '',
      '- [ ] One',
      '  - [X] Nested',
      '',
      '> - [x] Quoted',
      '',
      '1. [ ] Numbered',
    ].join('\n')
    const result = await renderer.render(source, new Set())
    expect(result.tasks.map((at) => source.slice(at, at + 3))).toEqual(['[ ]', '[X]', '[x]', '[ ]'])
    expect(result.tasks[0]).toBe(source.indexOf('- [ ] One') + 2)
    expect(JSON.stringify(result.blocks)).not.toContain('disabled')
  })

  it('resolves standard Markdown images and wikilink embeds in prose and tables', async () => {
    const renderer = createPreviewRenderer()
    renderer.setContext({
      theme: 'light',
      notes: [],
      folders: [
        { id: 'f-course', name: 'Математический анализ 1', parent_id: null },
        { id: 'f-notes', name: 'Заметки', parent_id: 'f-course' },
        { id: 'f-images', name: 'images', parent_id: 'f-course' },
        { id: 'f-other', name: 'other', parent_id: null },
      ],
      attachments: [
        {
          id: 'att-gif',
          filename: '8943ee10.gif',
          mime: 'image/gif',
          folder_id: 'f-images',
        },
        {
          id: 'att-course-img',
          filename: 'img.png',
          mime: 'image/png',
          folder_id: 'f-images',
        },
        {
          id: 'att-other-img',
          filename: 'img.png',
          mime: 'image/png',
          folder_id: 'f-other',
        },
      ],
      noteFolderId: 'f-notes',
    })

    const source = [
      '![Graph](../images/8943ee10.gif "Elementary function")',
      '',
      '| Функция | График |',
      '| --- | --- |',
      '| $y = x^2$ | ![](../images/8943ee10.gif) |',
      '',
      '![[images/8943ee10.gif]]',
      '',
      '![[8943ee10.gif]]',
      '',
      '![same in images](../images/img.png) and ![same in other](other/img.png)',
      '',
      '![ext](https://example.com/pic.png)',
    ].join('\n')

    const result = await renderer.render(source, new Set())
    const html = JSON.stringify(result.blocks)

    expect(html).toContain('"/api/v1/attachments/att-gif/download"')
    expect(html).toContain('"alt":"Graph"')
    expect(html).toContain('"title":"Elementary function"')
    expect(html).toContain('"tagName":"table"')
    expect(html).toContain('"/api/v1/attachments/att-course-img/download"')
    expect(html).toContain('"/api/v1/attachments/att-other-img/download"')
    expect(html).toContain('"src":"https://example.com/pic.png"')
  })

  it('renders the exact Matan README note cleanly', async () => {
    const renderer = createPreviewRenderer()
    const readme = `---
tags:
  - Математика
  - Лекция
  - Университет
course: Математический анализ 1
---

# Математический анализ 1

Курс по дисциплине "Математический анализ" для студентов технических специальностей НГТУ. Курс охватывает разделы: предел и непрерывность, дифференциальное и интегральное исчисления функции действительной переменной,  дифференциальное исчисление функций нескольких переменных.

## Содержание (только теория)

### 1. Вводный модуль
- [[01 - Правила введения ответов]]
- [[02 - Информация ФЭН (Лебедева Е.А.)]]
- [[03 - Информация АВТФ (Павшок Л.В.)]]
- [[04 - Информация ФЭН (Шеремет О.В., Шумский Г.М.)]]

### 2. Повторение
- [[01 - Функция действительной переменной]]
- [[02 - Графики элементарных функций]]
- [[03 - Кривые на плоскости полярная система координат]]
- [[04 - Кривые на плоскости параметрический способ задания]]

### 3. Предел и непрерывность ФОП
- [[01 - Понятие предела функции одной переменной]]
- [[02 - Бесконечно большие и бесконечно малые функции]]
- [[03 - Преодоление неопределенностей]]
- [[04 - Замечательные пределы]]
- [[05 - Сравнение бесконечно малых (бесконечно больших) функций]]
- [[06 - Непрерывность функции в точке и на множестве]]
- [[07 - Асимптоты графика функции]]

### 4. Дифференциальное исчисление функций одной переменной
- [[01 - Понятие производной. Физический и геометрический смысл производной]]
- [[02 - Дифференцирование сложной функции]]
- [[03 - Дифференцирование сложной функции (продолжение)]]
- [[04 - Дифференцирование функций, заданных неявно и параметрически]]
- [[05 - Уравнение касательной. Дифференциал функции]]
- [[06 - Основные теоремы дифференциального исчисления. Правила Лопиталя]]
- [[07 - Формула Тейлора]]
- [[08 - Исследование функций методами дифференциального исчисления]]

### 5. Интегральное исчисление функций одной переменной
- [[01 - Первообразная. Неопределенный интеграл]]
- [[02 - Метод внесения под знак дифференциала 1]]
- [[03 - Метод внесения под знак дифференциала 2]]
- [[04 - Метод внесения под знак дифференциала 3]]
- [[05 - Замена переменной в неопределенном интеграле. Интегрирование по частям]]
- [[06 - Интегрирование выражений, содержащих квадратный трехчлен в знаменателе]]
- [[07 - Интегрирование рациональных дробей]]
- [[08 - Интегрирование тригонометрических выражений]]
- [[09 - Интегрирование выражений с радикалами]]
- [[10 - Определенный интеграл]]
- [[11 - Несобственные интегралы]]
- [[12 - Приложения определенного интеграла. Вычисление площади]]
- [[13 - Приложения определенного интеграла. Вычисление длины дуги и объемов тел вращения]]

## Закрытые темы (недоступны для аккаунта)

- Дифференциальное исчисление функций многих переменных -> Предел, непрерывность и частные производные ФМП
- Дифференциальное исчисление функций многих переменных -> Частные производные и дифференциал ФМП
- Дифференциальное исчисление функций многих переменных -> Производная по направлению. Градиент
- Дифференциальное исчисление функций многих переменных -> Касательная плоскость и нормаль к поверхности
- Дифференциальное исчисление функций многих переменных -> Частные производные и дифференциалы высших порядков
- Дифференциальное исчисление функций многих переменных -> Формула Тейлора и экстремумы функции двух переменных
- Дифференциальное исчисление функций многих переменных -> Условный экстремум. Наибольшее и наименьшее значения функции`

    renderer.setContext({
      theme: 'dark',
      notes: [
        { id: 'n1', title: '01 - Правила введения ответов', folder_id: 'f-matan' },
        { id: 'n2', title: '02 - Графики элементарных функций', folder_id: 'f-matan' },
      ],
      folders: [
        { id: 'f-uni', name: 'University', parent_id: null },
        { id: 'f-math', name: 'Math', parent_id: 'f-uni' },
        { id: 'f-matan', name: 'Matan', parent_id: 'f-math' },
      ],
      attachments: [],
      noteFolderId: 'f-matan',
    })

    const result = await renderer.render(readme, new Set())
    expect(result.keys.length).toBeGreaterThan(0)
    const html = JSON.stringify(result.blocks)
    expect(html).toContain('Математический анализ 1')
    expect(html).toContain('02 - Графики элементарных функций')
  })
})
