import { test, expect } from '@playwright/test';

const table = {name:'public.demo',columns:[{name:'id',data_type:'integer',options:['updatable']},{name:'name',data_type:'text',options:['updatable']}],primary_keys:['id']};

test('hiện dữ liệu trước cấu hình và khóa sửa cho đến khi tải xong', async ({page}) => {
 let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve});let writes=0;
 await page.route('**/api/**',async route=>{const req=route.request(),path=new URL(req.url()).pathname;if(path==='/api/meta')return route.fulfill({json:{tables:[table],token:'csrf'}});if(path==='/api/formula-config'){await blocked;return route.fulfill({json:{items:[]}})}if(path==='/api/lookup-config')return route.fulfill({json:{available:false,items:[]}});if(req.method()==='PATCH'){writes++;return route.fulfill({json:{rows:[]}})}return route.fulfill({json:{rows:[{id:1,name:'Mia'}],total:1}})});
 await page.goto('/');const cell=page.locator('td[data-bulk-column="name"]');await expect(cell).toHaveText('Mia');await expect(cell).toHaveClass(/cell-readonly/);await expect(page.locator('#add')).toBeDisabled();await cell.click();await expect(page.locator('td.editing')).toHaveCount(0);await page.locator('td.record-detail').click();await expect(page.locator('#field-name')).toBeDisabled();expect(writes).toBe(0);release();await expect(cell).toHaveClass(/cell-editable/);await expect(page.locator('#field-name')).toBeEnabled();await expect(page.locator('#save')).toBeEnabled();await page.locator('#cancel').click();await expect(page.locator('#add')).toBeEnabled();await cell.click();await expect(page.locator('td.editing input')).toBeVisible();
});

test('lỗi cấu hình giữ chỉ đọc và thử lại mở khóa',async({page})=>{
 let attempts=0;
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;if(path==='/api/meta')return route.fulfill({json:{tables:[table],token:'csrf'}});if(path==='/api/formula-config'){attempts++;return attempts===1?route.fulfill({status:503,json:{error:'offline'}}):route.fulfill({json:{items:[]}})}if(path==='/api/lookup-config')return route.fulfill({json:{available:false,items:[]}});return route.fulfill({json:{rows:[{id:1,name:'Mia'}],total:1}})});
 await page.goto('/');const cell=page.locator('td[data-bulk-column="name"]');await expect(cell).toHaveText('Mia');await expect(page.locator('#retryConfig')).toBeVisible();await expect(cell).toHaveClass(/cell-readonly/);await page.locator('#retryConfig').click();await expect(cell).toHaveClass(/cell-editable/);await expect(page.locator('#configStatus')).toBeHidden();
});

test('chuyển bảng khi đang tải và chỉ khóa cột formula thực tế',async({page})=>{
 let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve});
 const second={...table,name:'public.other'};
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;if(path==='/api/meta')return route.fulfill({json:{tables:[table,second],token:'csrf'}});if(path==='/api/formula-config'){await blocked;return route.fulfill({json:{items:[{table:'other',column:'name',enabled:true}]}})}if(path==='/api/lookup-config')return route.fulfill({json:{available:false,items:[]}});return route.fulfill({json:{rows:[{id:1,name:path.endsWith('/other')?'Lune':'Mia'}],total:1}})});
 await page.goto('/');await expect(page.locator('td[data-bulk-column="name"]')).toHaveText('Mia');await page.locator('#tables button').filter({hasText:'other'}).click();const cell=page.locator('td[data-bulk-column="name"]');await expect(cell).toHaveText('Lune');release();await expect(page.locator('#configStatus')).toBeHidden();await expect(cell).toHaveClass(/cell-readonly/);await page.locator('#tables button').filter({hasText:'demo'}).click();await expect(page.locator('td[data-bulk-column="name"]')).toHaveClass(/cell-editable/);
});

test('dọn cấu hình lookup đã tắt chỉ sau khi dữ liệu hiện',async({page})=>{
 let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve});let cleaned=0;
 await page.route('**/api/**',async route=>{const req=route.request(),path=new URL(req.url()).pathname;if(path==='/api/meta')return route.fulfill({json:{tables:[table],token:'csrf'}});if(path==='/api/formula-config')return route.fulfill({json:{items:[]}});if(path==='/api/lookup-config')return route.fulfill({json:{available:true,items:[{id:'old',sourceTable:'demo',columnBound:true,sync:{enabled:false}}]}});if(path==='/api/lookup-config/cleanup-disabled'){cleaned++;return route.fulfill({json:{removed:1}})}if(path==='/api/table/demo'){await blocked;return route.fulfill({json:{rows:[{id:1,name:'Mia'}],total:1}})}return route.fulfill({json:{rows:[],total:0}})});
 await page.goto('/');await expect(page.locator('#configStatus')).toBeHidden();expect(cleaned).toBe(0);release();await expect(page.locator('td[data-bulk-column="name"]')).toHaveText('Mia');await expect.poll(()=>cleaned).toBe(1);
});
