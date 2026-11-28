// @vitest-environment node
import { execFileSync } from 'child_process';
import path from 'path';

// MUI's Slider crashed the plugin under Headlamp's theme: the lint
// configuration (package.json eslintConfig, as `npm run lint` uses it)
// refuses it in every import form.

function restricted(code: string): string[] {
  const eslint = path.resolve('node_modules', '.bin', 'eslint');
  const args = ['-c', 'package.json', '--format', 'json', '--stdin', '--stdin-filename', 'src/views/example.tsx'];
  let out: string;
  try {
    out = execFileSync(eslint, args, { input: code, encoding: 'utf8' });
  } catch (e) {
    // eslint exits 1 when it reports an error; the report is still on stdout.
    out = (e as { stdout: string }).stdout;
  }
  const [file] = JSON.parse(out) as { messages: { ruleId: string | null; message: string }[] }[];
  return file.messages.filter(m => m.ruleId === 'no-restricted-imports').map(m => m.message);
}

describe('the lint rule against MUI Slider', () => {
  it('fails on each way to import Slider, with the reason', () => {
    for (const code of [
      "import Slider from '@mui/material/Slider';\nexport const S = Slider;\n",
      "import { Slider } from '@mui/material';\nexport const S = Slider;\n",
      "import SliderRoot from '@mui/material/Slider/Slider';\nexport const S = SliderRoot;\n",
    ]) {
      const found = restricted(code);
      expect(found, code).toHaveLength(1);
      expect(found[0]).toMatch(/e\.charAt is not a function/);
    }
  }, 120000);

  it('lets the other MUI components through', () => {
    expect(restricted("import Box from '@mui/material/Box';\nimport { Button } from '@mui/material';\nexport const S = [Box, Button];\n")).toEqual([]);
  }, 60000);
});
