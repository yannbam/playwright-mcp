/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { z } from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';

import type * as playwright from 'patchright';
import type { Tool } from './tool';
import { generateLocator } from '../context';
import * as javascript from '../javascript';

const snapshot: Tool = {
  capability: 'core',
  schema: {
    name: 'browser_snapshot',
    description: 'Capture accessibility snapshot of the current page, this is better than screenshot',
    inputSchema: zodToJsonSchema(z.object({})),
  },

  handle: async context => {
    const tab = await context.ensureTab();
    return await tab.run(async () => {}, { captureSnapshot: true });
  },
};

const elementSchema = z.object({
  element: z.string().describe('Human-readable element description used to obtain permission to interact with the element'),
  ref: z.string().describe('Exact target element reference from the page snapshot'),
});

const click: Tool = {
  capability: 'core',
  schema: {
    name: 'browser_click',
    description: 'Perform click on a web page',
    inputSchema: zodToJsonSchema(elementSchema),
  },

  handle: async (context, params) => {
    const validatedParams = elementSchema.parse(params);
    return await context.currentTab().runAndWaitWithSnapshot(async snapshot => {
      const locator = snapshot.refLocator(validatedParams.ref);
      const action = `await page.${await generateLocator(locator)}.click();`;
      await locator.click();
      return action;
    }, {
      status: `Clicked "${validatedParams.element}"`,
    });
  },
};

const dragSchema = z.object({
  startElement: z.string().describe('Human-readable source element description used to obtain the permission to interact with the element'),
  startRef: z.string().describe('Exact source element reference from the page snapshot'),
  endElement: z.string().describe('Human-readable target element description used to obtain the permission to interact with the element'),
  endRef: z.string().describe('Exact target element reference from the page snapshot'),
});

const drag: Tool = {
  capability: 'core',
  schema: {
    name: 'browser_drag',
    description: 'Perform drag and drop between two elements',
    inputSchema: zodToJsonSchema(dragSchema),
  },

  handle: async (context, params) => {
    const validatedParams = dragSchema.parse(params);
    return await context.currentTab().runAndWaitWithSnapshot(async snapshot => {
      const startLocator = snapshot.refLocator(validatedParams.startRef);
      const endLocator = snapshot.refLocator(validatedParams.endRef);
      const action = `await page.${await generateLocator(startLocator)}.dragTo(page.${await generateLocator(endLocator)});`;
      await startLocator.dragTo(endLocator);
      return action;
    }, {
      status: `Dragged "${validatedParams.startElement}" to "${validatedParams.endElement}"`,
    });
  },
};

const hover: Tool = {
  capability: 'core',
  schema: {
    name: 'browser_hover',
    description: 'Hover over element on page',
    inputSchema: zodToJsonSchema(elementSchema),
  },

  handle: async (context, params) => {
    const validatedParams = elementSchema.parse(params);
    return await context.currentTab().runAndWaitWithSnapshot(async snapshot => {
      const locator = snapshot.refLocator(validatedParams.ref);
      const action = `await page.${await generateLocator(locator)}.hover();`;
      await locator.hover();
      return action;
    }, {
      status: `Hovered over "${validatedParams.element}"`,
    });
  },
};

const typeSchema = elementSchema.extend({
  text: z.string().describe('Text to type into the element'),
  submit: z.boolean().optional().describe('Whether to submit entered text (press Enter after)'),
  slowly: z.boolean().optional().describe('Whether to type one character at a time. Useful for triggering key handlers in the page. By default entire text is filled in at once.'),
});

const type: Tool = {
  capability: 'core',
  schema: {
    name: 'browser_type',
    description: 'Type text into editable element',
    inputSchema: zodToJsonSchema(typeSchema),
  },

  handle: async (context, params) => {
    const validatedParams = typeSchema.parse(params);
    return await context.currentTab().runAndWaitWithSnapshot(async snapshot => {
      const locator = snapshot.refLocator(validatedParams.ref);

      let action = '';
      if (validatedParams.slowly) {
        action = `await page.${await generateLocator(locator)}.pressSequentially(${javascript.quote(validatedParams.text)});`;
        await locator.pressSequentially(validatedParams.text);
      } else {
        action = `await page.${await generateLocator(locator)}.fill(${javascript.quote(validatedParams.text)});`;
        await locator.fill(validatedParams.text);
      }
      if (validatedParams.submit) {
        action += `\nawait page.${await generateLocator(locator)}.press('Enter');`;
        await locator.press('Enter');
      }
      return action;
    }, {
      status: `Typed "${validatedParams.text}" into "${validatedParams.element}"`,
    });
  },
};

const selectOptionSchema = elementSchema.extend({
  values: z.array(z.string()).describe('Array of values to select in the dropdown. This can be a single value or multiple values.'),
});

const selectOption: Tool = {
  capability: 'core',
  schema: {
    name: 'browser_select_option',
    description: 'Select an option in a dropdown',
    inputSchema: zodToJsonSchema(selectOptionSchema),
  },

  handle: async (context, params) => {
    const validatedParams = selectOptionSchema.parse(params);
    return await context.currentTab().runAndWaitWithSnapshot(async snapshot => {
      const locator = snapshot.refLocator(validatedParams.ref);
      const action = `await page.${await generateLocator(locator)}.selectOption(${javascript.formatObject(validatedParams.values)});`;
      await locator.selectOption(validatedParams.values);
      return action;
    }, {
      status: `Selected option in "${validatedParams.element}"`,
    });
  },
};

const screenshotSchema = z.object({
  raw: z.boolean().optional().describe('Whether to return without compression (in PNG format). Default is false, which returns a JPEG image.'),
});

const screenshot: Tool = {
  capability: 'core',
  schema: {
    name: 'browser_take_screenshot',
    description: `Take a screenshot of the current page. You can't perform actions based on the screenshot, use browser_snapshot for actions.`,
    inputSchema: zodToJsonSchema(screenshotSchema),
  },

  handle: async (context, params) => {
    const validatedParams = screenshotSchema.parse(params);
    const tab = context.currentTab();
    const options: playwright.PageScreenshotOptions = validatedParams.raw ? { type: 'png', scale: 'css' } : { type: 'jpeg', quality: 50, scale: 'css' };
    const screenshot = await tab.page.screenshot(options);
    return {
      content: [{ type: 'image', data: screenshot.toString('base64'), mimeType: validatedParams.raw ? 'image/png' : 'image/jpeg' }],
    };
  },
};

export default [
  snapshot,
  click,
  drag,
  hover,
  type,
  selectOption,
  screenshot,
];
