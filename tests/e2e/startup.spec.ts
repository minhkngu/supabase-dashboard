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

test('hiện cấu trúc đã lưu trước metadata và cập nhật cột thay đổi',async({page})=>{
 const old={name:'public.demo',primary_keys:['id'],columns:[{name:'id',data_type:'integer',options:['updatable']},{name:'name',data_type:'text',options:['updatable']},{name:'removed',data_type:'text',options:['updatable']}]};
 const current={...old,columns:old.columns.filter(c=>c.name!=='removed')};
 await page.addInitScript(table=>localStorage.setItem('siris-metadata-v1',JSON.stringify({tables:[table]})),old);
 let release=()=>{};const blocked=new Promise<void>(resolve=>{release=resolve});
 await page.route('**/api/**',async route=>{const url=new URL(route.request().url());
  if(url.pathname==='/api/meta'){await blocked;return route.fulfill({json:{tables:[current],token:'csrf'}})}
  if(url.pathname==='/api/formula-config')return route.fulfill({json:{items:[]}});
  if(url.pathname==='/api/lookup-config')return route.fulfill({json:{available:false,items:[]}});
  return route.fulfill({json:{rows:[{id:1,name:'Mia',removed:'cũ'}],total:1}});
 });
 await page.goto('/');await expect(page.locator('#grid')).toContainText('Mia');
 await expect(page.locator('th[data-column-id="col:removed"]')).toBeVisible();
 await expect(page.locator('#add')).toBeDisabled();release();
 await expect(page.locator('th[data-column-id="col:removed"]')).toHaveCount(0);
 await expect(page.locator('#add')).toBeEnabled();
});

test('quay lại trang đã xem hiện ngay và cập nhật sau làm mới nền',async({page})=>{
 const table={name:'public.demo',primary_keys:['id'],columns:[{name:'id',data_type:'integer',options:['updatable']},{name:'name',data_type:'text',options:['updatable']}]};
 let pageZeroLoads=0,release=()=>{};const blocked=new Promise<void>(resolve=>{release=resolve});
 await page.route('**/api/**',async route=>{const url=new URL(route.request().url());
  if(url.pathname==='/api/meta')return route.fulfill({json:{tables:[table],token:'t'}});
  if(url.pathname==='/api/formula-config')return route.fulfill({json:{items:[]}});
  if(url.pathname==='/api/lookup-config')return route.fulfill({json:{available:false,items:[]}});
  const n=Number(url.searchParams.get('page')||0);if(n===0&&++pageZeroLoads>1)await blocked;
  return route.fulfill({json:{rows:[{id:n+1,name:n?'Trang hai':pageZeroLoads>1?'Mới':'Ban đầu'}],total:url.searchParams.get('count')==='none'?null:51}});
 });
 await page.goto('/');await expect(page.locator('#grid')).toContainText('Ban đầu');
 await page.locator('#next').click();await expect(page.locator('#grid')).toContainText('Trang hai');
 await page.locator('#prev').click();await expect(page.locator('#grid')).toContainText('Ban đầu');
 release();await expect(page.locator('#grid')).toContainText('Mới');
});

test('tìm từ hai ký tự, đếm sau khi dừng và chọn cột',async({page})=>{
 const table={name:'public.demo',primary_keys:['id'],columns:[{name:'id',data_type:'integer',options:['updatable']},{name:'name',data_type:'text',options:['updatable']},{name:'note',data_type:'text',options:['updatable']}]};
 const searches:Array<{search:string,count:string,column:string}>=[];
 await page.route('**/api/**',async route=>{const url=new URL(route.request().url());
  if(url.pathname==='/api/meta')return route.fulfill({json:{tables:[table],token:'t'}});
  if(url.pathname==='/api/formula-config')return route.fulfill({json:{items:[]}});
  if(url.pathname==='/api/lookup-config')return route.fulfill({json:{available:false,items:[]}});
  searches.push({search:url.searchParams.get('search')||'',count:url.searchParams.get('count')||'exact',column:url.searchParams.get('search_column')||''});
  return route.fulfill({json:{rows:[{id:1,name:'Mia',note:'A'}],total:url.searchParams.get('count')==='none'?null:1}});
 });
 await page.goto('/');await expect(page.locator('#grid')).toContainText('Mia');const initial=searches.length;
 await page.locator('#search').fill('M');await expect(page.locator('#message')).toContainText('ít nhất 2');await page.waitForTimeout(450);expect(searches).toHaveLength(initial);
 await page.locator('#search').fill('Mi');await expect.poll(()=>searches.some(x=>x.search==='Mi'&&x.count==='none')).toBe(true);
 await expect.poll(()=>searches.some(x=>x.search==='Mi'&&x.count==='exact')).toBe(true);
 await page.locator('#searchColumn').selectOption('name');await expect.poll(()=>searches.some(x=>x.search==='Mi'&&x.column==='name')).toBe(true);
});
