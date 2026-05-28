#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'fs';
import { join, dirname, relative, extname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SRC_DIR = join(__dirname, 'src');
const COMPONENTS_DIR = join(SRC_DIR, 'components');
const OUTPUT_DIR = join(__dirname, '.build-temp');

/**
 * Parse component props from JSON string
 */
function parseProps(propsString) {
  if (!propsString) return {};
  try {
    return JSON.parse(propsString);
  } catch (e) {
    console.error(`Error parsing props: ${propsString}`);
    return {};
  }
}

/**
 * Replace template variables in content
 * Supports: {{propName}}, {{props.propName}}
 */
function replaceTemplateVars(content, props) {
  return content.replace(/\{\{([\w.]+)\}\}/g, (match, key) => {
    // Handle both {{key}} and {{props.key}}
    const propKey = key.startsWith('props.') ? key.slice(6) : key;
    return props[propKey] !== undefined ? props[propKey] : match;
  });
}

/**
 * Process component tag and replace with component content
 */
function processComponent(html, componentPath, basePath) {
  // Match: <component src="..." props="{...}">...</component>
  // Also supports self-closing: <component src="..." />
  const componentRegex = /<component\s+src="([^"]+)"(?:\s+props=(['"])(\{[^}]*\})\2)?(?:\s*\/>|>([\s\S]*?)<\/component>)/gi;

  let result = html;
  let match;

  while ((match = componentRegex.exec(html)) !== null) {
    const [fullMatch, src, , propsJson, slotContent = ''] = match;

    // Load component file
    const componentFilePath = join(COMPONENTS_DIR, src);
    if (!existsSync(componentFilePath)) {
      console.error(`Component not found: ${componentFilePath}`);
      continue;
    }

    let componentContent = readFileSync(componentFilePath, 'utf-8');

    // Parse props
    const props = parseProps(propsJson);

    // Replace slot content
    if (slotContent.trim()) {
      componentContent = componentContent.replace(/<slot\s*\/?>(<\/slot>)?/gi, slotContent);
    } else {
      // Remove empty slots
      componentContent = componentContent.replace(/<slot\s*\/?>(<\/slot>)?/gi, '');
    }

    // Replace template variables
    componentContent = replaceTemplateVars(componentContent, props);

    // Recursively process nested components
    componentContent = processComponent(componentContent, componentFilePath, basePath);

    result = result.replace(fullMatch, componentContent);
  }

  return result;
}

/**
 * Process a single HTML file
 */
function processHtmlFile(inputPath, outputPath) {
  console.log(`Processing: ${relative(SRC_DIR, inputPath)}`);

  let html = readFileSync(inputPath, 'utf-8');

  // Process components
  html = processComponent(html, inputPath, SRC_DIR);

  // Write output
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  writeFileSync(outputPath, html, 'utf-8');
}

/**
 * Process all HTML files in directory
 */
function processDirectory(srcDir, outDir) {
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  const entries = readdirSync(srcDir);

  for (const entry of entries) {
    const srcPath = join(srcDir, entry);
    const outPath = join(outDir, entry);

    // Skip components directory
    if (srcPath === COMPONENTS_DIR) {
      continue;
    }

    const stat = statSync(srcPath);

    if (stat.isDirectory()) {
      processDirectory(srcPath, outPath);
    } else if (extname(entry) === '.html') {
      processHtmlFile(srcPath, outPath);
    }
  }
}

// Main execution
console.log('Starting SSG build...');
console.log(`Source: ${SRC_DIR}`);
console.log(`Output: ${OUTPUT_DIR}`);

try {
  processDirectory(SRC_DIR, OUTPUT_DIR);
  console.log('SSG build complete!');
} catch (error) {
  console.error('Build failed:', error);
  process.exit(1);
}
