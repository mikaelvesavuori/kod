# Kod Marketing Site

Marketing site for [Kod](https://itskod.com).

## Commands

```bash
npm run dev
npm run build
```

## Using Components

```html
<!-- Simple -->
<component src="nav.html" />

<!-- With props -->
<component src="head.html" props='{"title": "Page Title"}'>
  <!-- Optional slot content -->
</component>
```

Component file uses `{{propName}}` for variables and `<slot />` for content.

## License

MIT.
