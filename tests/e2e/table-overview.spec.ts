import { test, expect, type Page } from '@playwright/test';
const col=(name:string)=>({name,data_type:'text',options:['nullable','updatable']});
const branches={name:'public.branches',primary_keys:['id'],columns:['id','name','address','is_hidden'].map(col)};
const rooms={name:'public.room_types',primary_keys:['id'],columns:['id','name','branchid','weekdayprice','weekendprice','sqm','is_hidden'].map(col)};
const items={name:'public.items',primary_keys:['id'],columns:['id','item_name','kind','quantity','unit_price'].map(col)};
const other={name:'public.other',primary_keys:['id'],columns:['id','title','notes'].map(col)};
async function mock(page:Page){let fail=false,writes=0;await page.route('**/api/**',async (route)=>{const req=route.request(),url=new URL(req.url());if(req.method()!=='GET'){writes++;return route.fulfill({json:{}})}if(url.pathname==='/api/meta')return route.fulfill({json:{tables:[branches,rooms,items,other],token:'t'}});if(url.pathname==='/api/formula-config')return route.fulfill({json:{items:[]}});if(url.pathname==='/api/lookup-config')return route.fulfill({json:{available:false,items:[]}});if(fail&&url.pathname==='/api/table/items')return route.fulfill({status:403,json:{error:'Không có quyền đọc'}});const values:Record<string, Record<string, string | number | boolean>[]>={'/api/table/branches':[{id:'b1',name:'Mia',address:'Địa chỉ',is_hidden:false}],'/api/table/room_types':[{id:'r1',name:'Studio',branchid:'b1',weekdayprice:440,weekendprice:480,sqm:25,is_hidden:false}],'/api/table/items':[{id:1,item_name:'Khăn',kind:'Vải',quantity:3,unit_price:20000}],'/api/table/other':[{id:1,title:'Thử',notes:'Nội dung'}]};const rows=values[url.pathname]||[];return route.fulfill({json:{rows,total:rows.length}})});return {setFail:()=>{fail=true},writes:()=>writes}}
test('dashboard xem thông tin, chi tiết, tìm kiếm và giữ chế độ theo bảng',async({page})=>{const api=await mock(page);await page.goto('/');await page.getByRole('button',{name:'Dashboard',exact:true}).click();await expect(page.locator('#tableDashboard')).toContainText('Tổng quan chi nhánh');await expect(page.locator('#tableDashboard')).toContainText('Mia');await expect(page.locator('#add')).toBeVisible();await page.getByRole('button',{name:'room_types',exact:true}).click();await page.getByRole('button',{name:'Dashboard',exact:true}).click();await expect(page.locator('#tableDashboard')).toContainText('Studio');await expect(page.locator('#tableDashboard')).toContainText('Mia');await expect(page.locator('#tableDashboard')).toContainText('440đ');await page.getByRole('button',{name:'Xem chi tiết Studio'}).click();await expect(page.locator('dialog[open]')).toContainText('480đ');await page.getByRole('button',{name:'Đóng chi tiết'}).click();await page.getByRole('button',{name:'items',exact:true}).click();await page.getByRole('button',{name:'Dashboard',exact:true}).click();await expect(page.locator('#tableDashboard')).toContainText('60.000đ');await page.locator('[data-overview-search]').fill('khăn');await expect(page.locator('[data-overview-count]')).toHaveText('1 / 1 bản ghi');await api.setFail();await page.locator('[data-overview-refresh]').click();await expect(page.locator('[data-overview-feedback]')).toContainText('Đang giữ dữ liệu lần trước');await page.getByRole('button',{name:'Bảng dữ liệu',exact:true}).click();await expect(page.locator('.grid-shell')).toBeVisible();await page.getByRole('button',{name:'other',exact:true}).click();await page.getByRole('button',{name:'Dashboard',exact:true}).click();await expect(page.locator('#tableDashboard')).toContainText('Thử');await page.reload();await expect(page.locator('#title')).toHaveText('other');await page.getByRole('button',{name:'items',exact:true}).click();await expect(page.locator('.grid-shell')).toBeVisible();expect(api.writes()).toBe(0)});
test('dashboard vừa màn hình nhỏ',async({page})=>{await page.setViewportSize({width:390,height:844});await mock(page);await page.goto('/');await page.getByRole('button',{name:'Dashboard',exact:true}).click();await expect(page.locator('#tableDashboard')).toContainText('Mia');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)});


test('nút chuyển chế độ giữ vị trí khi đổi chế độ',async({page})=>{
 await mock(page);await page.goto('/');
 const view=page.locator('#promotionsViewSwitch');
 await expect(view).toBeVisible();
 const before=await view.boundingBox();
 const addBefore=await page.locator('#add').boundingBox();
 await page.getByRole('button',{name:'Dashboard',exact:true}).click();
 const after=await view.boundingBox();
 const addAfter=await page.locator('#add').boundingBox();
 expect(addBefore).not.toBeNull();expect(addAfter).not.toBeNull();
 expect(Math.abs(addAfter!.x-addBefore!.x)).toBeLessThanOrEqual(1);
 expect(before).not.toBeNull();expect(after).not.toBeNull();
 expect(Math.abs(after!.x-before!.x)).toBeLessThanOrEqual(1);
 await page.getByRole('button',{name:'Bảng dữ liệu',exact:true}).click();
 await expect(page.locator('#add')).toBeVisible();
});

test('thêm bản ghi từ dashboard và làm mới danh sách',async({page})=>{
 await mock(page);
 const rows=[{id:'b1',name:'Mia',address:'Địa chỉ',is_hidden:false}];
 let posted=false;
 await page.route('**/api/table/branches**',async route=>{
  if(route.request().method()==='POST'){
   const {values}=route.request().postDataJSON();
   posted=true;rows.push({id:values.id,name:values.name,address:values.address||'',is_hidden:false});
   return route.fulfill({json:{rows:[rows.at(-1)]}});
  }
  return route.fulfill({json:{rows,total:rows.length}});
 });
 await page.goto('/');
 await page.getByRole('button',{name:'Dashboard',exact:true}).click();
 await expect(page.locator('#tableDashboard')).toContainText('Mia');
 await page.locator('#add').click();
 await page.locator('#field-id').fill('b2');
 await page.locator('#field-name').fill('Chi nhánh mới');
 await page.locator('#save').click();
 await expect(page.locator('#editor')).toBeHidden();
 await expect(page.locator('#tableDashboard')).toContainText('Chi nhánh mới');
 expect(posted).toBe(true);
});

test('sửa bản ghi từ dashboard gửi đúng khóa và không hiện nút xóa',async({page})=>{
 await mock(page);
 let patch: {key: {id:string},values: {name:string}} | undefined;
 await page.route('**/api/table/branches**',async route=>{
  if(route.request().method()==='PATCH'){
   patch=route.request().postDataJSON();
   return route.fulfill({json:{rows:[{id:'b1',name:patch!.values.name}]}});
  }
  return route.fulfill({json:{rows:[{id:'b1',name:patch?.values.name||'Mia',address:'Địa chỉ',is_hidden:false}],total:1}});
 });
 await page.goto('/');await page.getByRole('button',{name:'Dashboard',exact:true}).click();
 await page.getByRole('button',{name:'Xem chi tiết Mia'}).click();
 await page.getByRole('button',{name:'Sửa bản ghi',exact:true}).click();
 await expect(page.locator('#delete')).toBeHidden();
 await page.locator('#field-name').fill('Mia mới');await page.locator('#save').click();
 await expect(page.locator('#tableDashboard')).toContainText('Mia mới');
 expect(patch?.key).toEqual({id:'b1'});expect(patch?.values.name).toBe('Mia mới');
});


test('thanh tiêu đề vừa màn hình 390px',async({page})=>{
 await page.setViewportSize({width:390,height:844});await mock(page);await page.goto('/');
 const add=page.locator('#add');await expect(add).toBeVisible();
 const box=await add.boundingBox();expect(box).not.toBeNull();
 expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(390);
 const menu=await page.locator('#openNav').boundingBox();expect(menu).not.toBeNull();
 expect(menu!.width).toBeGreaterThanOrEqual(36);expect(menu!.height).toBeGreaterThanOrEqual(36);
 await page.locator('#openNav').click();await expect(page.locator('#toggleSidebar')).toBeHidden();
 await expect(page.locator('#sidebarToggleBtn')).toBeHidden();
 const close=await page.locator('#closeNav').boundingBox();expect(close).not.toBeNull();
 expect(close!.width).toBeGreaterThanOrEqual(36);expect(close!.height).toBeGreaterThanOrEqual(36);
});

for(const viewport of [{name:'desktop',width:1440,height:900},{name:'mobile',width:390,height:844}]){
 test(`ảnh đối chiếu ${viewport.name}`,async({page})=>{
  await page.setViewportSize({width:viewport.width,height:viewport.height});await mock(page);await page.goto('/');
  await expect(page.locator('#grid tbody tr')).toHaveCount(1);
  await page.screenshot({path:`test-results/comparison-${viewport.name}-grid.png`,fullPage:true});
  await page.getByRole('checkbox',{name:'Chọn tất cả dòng hiển thị trên trang',exact:true}).check();
  await page.screenshot({path:`test-results/comparison-${viewport.name}-selection.png`,fullPage:true});
  await page.getByRole('button',{name:'Dashboard',exact:true}).click();
  await expect(page.locator('#tableDashboard')).toContainText('Mia');
  await page.screenshot({path:`test-results/comparison-${viewport.name}-overview.png`,fullPage:true});
  await page.getByRole('button',{name:'Xem chi tiết Mia'}).click();
  await page.getByRole('button',{name:'Sửa bản ghi',exact:true}).click();
  await expect(page.locator('#editor')).toBeVisible();
  await page.screenshot({path:`test-results/comparison-${viewport.name}-editor.png`,fullPage:true});
 });
}
