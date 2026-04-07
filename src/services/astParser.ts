import { parse } from '@babel/parser';

export interface LogicUnit {
  title: string;
  code: string;
  startLine: number;
  endLine: number;
}

// Simple AST walker to find specific nodes
function walk(node: any, visitor: (n: any) => void) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach(child => walk(child, visitor));
    return;
  }
  visitor(node);
  for (const key in node) {
    if (key !== 'loc' && key !== 'start' && key !== 'end' && key !== 'comments') {
      walk(node[key], visitor);
    }
  }
}

// Check if a function contains JSX
function hasJSX(node: any): boolean {
  let found = false;
  walk(node, (n) => {
    if (n.type === 'JSXElement' || n.type === 'JSXFragment') found = true;
  });
  return found;
}

const getCodeSnippet = (lines: string[], startLine: number, endLine: number) => {
  return lines.slice(startLine - 1, endLine).join('\n');
};

export function parseCodeToNodes(filePath: string, code: string, granularity: number = 2): LogicUnit[] {
  const units: LogicUnit[] = [];
  const lines = code.split('\n');

  try {
    const plugins: any[] = ['jsx'];
    if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
      plugins.push('typescript');
    }

    const ast = parse(code, {
      sourceType: 'module',
      plugins,
    });

    if (granularity === 1) {
      // Level 1: File Level - One node for the entire file
      units.push({
        title: filePath.split('/').pop() || 'File',
        code: code,
        startLine: 1,
        endLine: lines.length,
      });
      return units;
    }

    // For Level 2 and 3, we traverse the AST
    walk(ast.program, (node: any) => {
      if (!node.loc) return;
      let title = '';
      let isSignificant = false;

      // Top-level declarations (Level 2 & 3)
      if (node.type === 'FunctionDeclaration') {
        title = node.id?.name || 'AnonymousFunction';
        isSignificant = true;
      } else if (node.type === 'ClassDeclaration') {
        title = node.id?.name || 'AnonymousClass';
        isSignificant = true;
      } else if (node.type === 'VariableDeclarator' && node.init && (node.init.type === 'ArrowFunctionExpression' || node.init.type === 'FunctionExpression')) {
        // Arrow functions assigned to variables (e.g., const MyComponent = () => {})
        if (node.id && node.id.type === 'Identifier') {
          title = node.id.name;
          isSignificant = true;
        }
      }

      // Deep level extraction (Level 3)
      if (granularity === 3) {
        if (node.type === 'CallExpression' && node.callee.type === 'Identifier') {
          if (node.callee.name === 'useEffect') {
            title = 'useEffect_Hook';
            isSignificant = true;
          } else if (node.callee.name === 'useCallback') {
            title = 'useCallback_Hook';
            isSignificant = true;
          } else if (node.callee.name === 'useMemo') {
            title = 'useMemo_Hook';
            isSignificant = true;
          }
        }
      }

      if (isSignificant && title) {
        // Avoid adding duplicate overlapping nodes if possible, but for simplicity we just add them.
        // We can append line numbers to avoid duplicate titles
        const uniqueTitle = `${title}_L${node.loc.start.line}`;
        units.push({
          title: uniqueTitle,
          code: getCodeSnippet(lines, node.loc.start.line, node.loc.end.line),
          startLine: node.loc.start.line,
          endLine: node.loc.end.line,
        });
      }
    });

    // If no units found (e.g., just a bunch of statements), fallback to file level
    if (units.length === 0) {
      units.push({
        title: filePath.split('/').pop() || 'File',
        code: code,
        startLine: 1,
        endLine: lines.length,
      });
    }

    // Sort units by start line
    units.sort((a, b) => a.startLine - b.startLine);

  } catch (error) {
    console.error(`Failed to parse AST for ${filePath}:`, error);
    units.push({
      title: filePath.split('/').pop() || 'UnknownFile',
      code: code,
      startLine: 1,
      endLine: lines.length,
    });
  }

  return units;
}
