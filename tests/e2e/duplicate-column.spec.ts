import {test,expect} from '@playwright/test';

test('nhân bản cột lưu nền, giữ dữ liệu nguồn và cập nhật cột cạnh nguồn',async({page})=>{
 let applied=false;let resolveApply!:()=>void;const waitApply=new Promise<void>(resolve=>{resolveApply=resolve});
 await page.route('**/api/**',async route=>{const req=route.request(),path=new URL(req.url()).pathname;
 if(path==='/api/meta')return route.fulfill({json:{tables:[{name:'public.rooms',columns:[{name:'id',data_type:'integer',options:['updatable']},{name:'price',data_type:'numeric',format:'numeric(12,2)',options:['nullable','updatable']},...(applied?[{name:'price_copy',data_type:'numeric',format:'numeric(12,2)',options:['nullable','updatable']}]:[])],primary_keys:['id']}],token:'csrf',adminAvailable:true}});
 if(path==='/api/formula-config')return route.fulfill({json:{items:[]}});if(path==='/api/lookup-config')return route.fulfill({json:{available:false,items:[]}});
 if(path==='/api/admin/schema/preview'){expect(req.postDataJSON()).toEqual({table:'rooms',column:'price',newName:'price_copy',action:'duplicate'});return route.fulfill({json:{signature:'a'.repeat(64),affected:2}})}
 if(path==='/api/admin/schema/apply'){await waitApply;applied=true;return route.fulfill({json:{ok:true}})}
 return route.fulfill({json:{rows:[{id:1,price:'1250.50',...(applied?{price_copy:'1250.50'}:{})},{id:2,price:null,...(applied?{price_copy:null}:{})}],total:2}});
 });
 await page.goto('/');await page.getByRole('button',{name:'Thiết lập cột price',exact:true}).click();await page.locator('#duplicateColumn').click();await expect(page.locator('#duplicateColumnName')).toHaveValue('price_copy');await page.locator('#saveDuplicateColumn').click();await expect(page.locator('#duplicateColumnDialog')).toBeHidden();expect(applied).toBe(false);resolveApply();await expect(page.locator('td[data-bulk-column="price_copy"]').first()).toHaveText('1,250.50');await expect(page.locator('td[data-bulk-column="price"]').first()).toHaveText('1,250.50');expect(await page.locator('#grid thead th[data-column-id]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-column-id')))).toEqual(['col:id','col:price','col:price_copy']);
});

test('nhân bản lỗi giữ tên để thử lại và không sửa dữ liệu nguồn',async({page})=>{
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;if(path==='/api/meta')return route.fulfill({json:{tables:[{name:'public.rooms',columns:[{name:'id',data_type:'integer',options:['updatable']},{name:'price',data_type:'integer',options:['updatable']}],primary_keys:['id']}],token:'csrf',adminAvailable:true}});if(path==='/api/formula-config')return route.fulfill({json:{items:[]}});if(path==='/api/lookup-config')return route.fulfill({json:{available:false,items:[]}});if(path==='/api/admin/schema/preview')return route.fulfill({status:400,json:{error:'Tên cột đã tồn tại.'}});return route.fulfill({json:{rows:[{id:1,price:42}],total:1}})});
 await page.goto('/');await page.getByRole('button',{name:'Thiết lập cột price',exact:true}).click();await page.locator('#duplicateColumn').click();await page.locator('#duplicateColumnName').fill('another_price');await page.locator('#saveDuplicateColumn').click();await expect(page.locator('#duplicateColumnDialog')).toBeVisible();await expect(page.locator('#duplicateColumnError')).toContainText('đã tồn tại');await expect(page.locator('#duplicateColumnName')).toHaveValue('another_price');await expect(page.locator('td[data-bulk-column="price"]')).toHaveText('42');
});
