// Validation for future persistent lookup columns. Never accepts SQL fragments.
const identifier=/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;
const supported=new Set(['text','character varying','character','varchar','uuid','smallint','integer','bigint','numeric','decimal','real','double precision','boolean','date','timestamp without time zone','timestamp with time zone']);
const family=type=>/^(integer|smallint|bigint|numeric|decimal|real|double precision)$/.test(type)?'number':/^(text|character varying|character|varchar)$/.test(type)?'text':type;
export function previewMaterializedLookup(config,tables){
 if(!config||typeof config!=='object'||!identifier.test(config.sourceTable||'')||!identifier.test(config.targetTable||'')||!identifier.test(config.columnName||''))throw Error('Tên bảng hoặc cột không hợp lệ.');
 const source=tables.find(t=>t.name===`public.${config.sourceTable}`),target=tables.find(t=>t.name===`public.${config.targetTable}`);if(!source||!target)throw Error('Không tìm thấy bảng.');
 if(source.name===target.name)throw Error('Lookup trong cùng bảng chưa được hỗ trợ.');
 if(!source.primary_keys?.length||!target.primary_keys?.length)throw Error('Hai bảng cần có khóa chính.');
 if(source.columns.some(c=>c.name.toLowerCase()===config.columnName.toLowerCase()))throw Error('Tên cột đã tồn tại.');
 const field=target.columns.find(c=>c.name===config.targetField);if(!field||!supported.has(field.data_type))throw Error('Kiểu trường nguồn chưa được hỗ trợ.');
 if(!Array.isArray(config.conditions)||config.conditions.length!==1||config.mode==='any')throw Error('Hiện chỉ hỗ trợ một điều kiện bằng.');
 const condition=config.conditions[0],left=source.columns.find(c=>c.name===condition.sourceColumn),right=target.columns.find(c=>c.name===condition.targetKey);
 if(!left||!right||!supported.has(left.data_type)||!supported.has(right.data_type)||family(left.data_type)!==family(right.data_type))throw Error('Cột đối chiếu không hợp lệ hoặc khác kiểu.');
 const unique=[target.primary_keys,...(target.unique_constraints||[]).map(c=>c.columns)].some(keys=>keys.length===1&&keys[0]===right.name);
 if(!unique)throw Error('Cột đối chiếu của bảng nguồn phải duy nhất.');
 return {sourceTable:config.sourceTable,targetTable:config.targetTable,columnName:config.columnName,targetField:field.name,dataType:field.data_type,conditions:[{sourceColumn:left.name,targetKey:right.name}],effects:['Thêm cột trong bảng hiện tại','Cập nhật giá trị các bản ghi hiện có','Tạo trigger đồng bộ khi dữ liệu hai bảng thay đổi']};
}

// Build only from validated metadata. The executor is deliberately not exposed by the web API.
// Caller must hold locks and revalidate schema before executing these statements.
export function buildSyncStatements(preview,token){
 if(!/^[a-f0-9]{24}$/.test(token))throw Error('Mã đồng bộ không hợp lệ.');
 if(!preview||![preview.sourceTable,preview.targetTable,preview.columnName,preview.targetField,preview.conditions?.[0]?.sourceColumn,preview.conditions?.[0]?.targetKey].every(value=>typeof value==='string'&&identifier.test(value))||preview.conditions?.length!==1||preview.sourceTable===preview.targetTable)throw Error('Cấu hình đồng bộ không hợp lệ.');
 const quote=value=>'"'+value.replaceAll('"','""')+'"';
 const source=`public.${quote(preview.sourceTable)}`,target=`public.${quote(preview.targetTable)}`;
 const column=quote(preview.columnName),field=quote(preview.targetField),left=quote(preview.conditions[0].sourceColumn),right=quote(preview.conditions[0].targetKey);
 if(!supported.has(preview.dataType))throw Error('Kiểu dữ liệu không được hỗ trợ.');
 const targetFunction=`siris_admin.${quote('lookup_row_'+token)}`,sourceFunction=`siris_admin.${quote('lookup_refresh_'+token)}`;
 const rowTrigger=quote('lookup_row_'+token),refreshTrigger=quote('lookup_refresh_'+token);
 return [
  `ALTER TABLE ${source} ADD COLUMN ${column} ${preview.dataType}`,
  `CREATE FUNCTION ${targetFunction}() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $sync$ BEGIN SELECT t.${field} INTO NEW.${column} FROM ${target} AS t WHERE t.${right} = NEW.${left} FOR SHARE; RETURN NEW; END $sync$`,
  `CREATE TRIGGER ${rowTrigger} BEFORE INSERT OR UPDATE OF ${left}, ${column} ON ${source} FOR EACH ROW EXECUTE FUNCTION ${targetFunction}()`,
  `CREATE FUNCTION ${sourceFunction}() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $sync$ BEGIN IF TG_OP <> 'INSERT' THEN UPDATE ${source} SET ${column} = ${column} WHERE ${left} = OLD.${right}; END IF; IF TG_OP <> 'DELETE' THEN UPDATE ${source} SET ${column} = ${column} WHERE ${left} = NEW.${right}; END IF; RETURN NULL; END $sync$`,
  `CREATE TRIGGER ${refreshTrigger} AFTER INSERT OR UPDATE OF ${right}, ${field} OR DELETE ON ${target} FOR EACH ROW EXECUTE FUNCTION ${sourceFunction}()`,
  `UPDATE ${source} SET ${column} = ${column}`
 ];
}
