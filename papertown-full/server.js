import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import multer from 'multer';
import nodemailer from 'nodemailer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const db = new Database(path.join(__dirname, 'data', 'papertown.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT UNIQUE NOT NULL,password_hash TEXT,display_name TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'member',verified INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL,expires_at INTEGER NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS addresses(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,label TEXT NOT NULL,recipient TEXT NOT NULL,phone TEXT NOT NULL,address_line TEXT NOT NULL,subdistrict TEXT NOT NULL,district TEXT NOT NULL,province TEXT NOT NULL,postcode TEXT NOT NULL,is_default INTEGER NOT NULL DEFAULT 0,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS books(id INTEGER PRIMARY KEY AUTOINCREMENT,isbn TEXT UNIQUE,title TEXT NOT NULL,author TEXT NOT NULL,category TEXT NOT NULL,description TEXT NOT NULL,condition TEXT NOT NULL DEFAULT 'ดี',status TEXT NOT NULL DEFAULT 'available',cover TEXT,stock INTEGER NOT NULL DEFAULT 1,total INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS borrows(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,book_id INTEGER NOT NULL,address_id INTEGER,method TEXT NOT NULL,borrowed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,due_at TEXT NOT NULL,returned_at TEXT,status TEXT NOT NULL DEFAULT 'borrowing',incoming_tracking TEXT,return_tracking TEXT,FOREIGN KEY(user_id) REFERENCES users(id),FOREIGN KEY(book_id) REFERENCES books(id),FOREIGN KEY(address_id) REFERENCES addresses(id));
CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,book_id INTEGER NOT NULL,text TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id),FOREIGN KEY(book_id) REFERENCES books(id));
CREATE TABLE IF NOT EXISTS donations(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,title TEXT NOT NULL,author TEXT,condition TEXT NOT NULL,photo TEXT,delivery_method TEXT NOT NULL,notes TEXT,status TEXT NOT NULL DEFAULT 'pending',admin_note TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id));
`);

const seed = db.prepare('SELECT COUNT(*) c FROM books').get().c;
if (!seed) {
  const ins = db.prepare('INSERT INTO books(isbn,title,author,category,description,condition,status,stock,total,cover) VALUES(?,?,?,?,?,?,?,?,?,?)');
  [
    ['9786160000011','ร้านชำของคุณป้า','นภัสสร','นิยาย','เรื่องราวอบอุ่นของร้านชำเล็ก ๆ ที่เชื่อมโยงผู้คนในชุมชนผ่านหนังสือและความทรงจำ','ดีมาก','available',3,3,'sage'],
    ['9786160000028','Atomic Habits','James Clear','พัฒนาตัวเอง','คู่มือสร้างนิสัยเล็ก ๆ ที่นำไปสู่การเปลี่ยนแปลงครั้งใหญ่ อ่านง่ายและนำไปใช้ได้จริง','ดี','available',2,2,'paper'],
    ['9786160000035','ก่อนโลกจะโอบกอดเรา','พิมพ์ชนก','วรรณกรรม','บันทึกความสัมพันธ์ ความสูญเสีย และการเติบโตอย่างอ่อนโยน','ดีมาก','available',1,1,'terra'],
    ['9786160000042','Designing Your Life','Bill Burnett & Dave Evans','การออกแบบ','แนวคิดการออกแบบชีวิตด้วยวิธีคิดแบบนักออกแบบ','ดี','available',2,2,'olive'],
    ['9786160000059','The Creative Act','Rick Rubin','ศิลปะและความคิดสร้างสรรค์','มุมมองเรียบง่ายต่อกระบวนการสร้างสรรค์และการทำงานกับไอเดีย','ใหม่','available',1,1,'ink']
  ].forEach(x=>ins.run(...x));
}
const admin = db.prepare('SELECT id FROM users WHERE email=?').get('admin@papertown.local');
if (!admin) db.prepare('INSERT INTO users(email,password_hash,display_name,role,verified) VALUES(?,?,?,?,1)').run('admin@papertown.local',bcrypt.hashSync('PaperTown@1234',10),'PaperTown Admin','admin');

app.use(express.json({limit:'3mb'}));
app.use(express.urlencoded({extended:true}));
app.use(cookieParser());
app.use(express.static(path.join(__dirname,'public')));

const upload = multer({dest:path.join(__dirname,'public','uploads'), limits:{fileSize:5*1024*1024}, fileFilter:(req,file,cb)=>cb(null,/^image\/(jpeg|png|webp|jpg)$/.test(file.mimetype))});

function user(req){
  const t=req.cookies.pt_session; if(!t) return null;
  const s=db.prepare('SELECT * FROM sessions WHERE token=? AND expires_at>?').get(t,Date.now());
  return s ? db.prepare('SELECT id,email,display_name,role,verified FROM users WHERE id=?').get(s.user_id) : null;
}
function requireAuth(req,res,next){const u=user(req);if(!u)return res.status(401).json({error:'กรุณาเข้าสู่ระบบ'});req.user=u;next();}
function requireAdmin(req,res,next){requireAuth(req,res,()=>{if(req.user.role!=='admin')return res.status(403).json({error:'สำหรับผู้ดูแลระบบเท่านั้น'});next();});}
function session(res,userId){const token=crypto.randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(token,userId,Date.now()+30*24*3600*1000);res.cookie('pt_session',token,{httpOnly:true,sameSite:'lax',secure:false,maxAge:30*24*3600*1000});}
function sendMail(to,subject,html){
  if(!process.env.SMTP_HOST)return Promise.resolve(false);
  const transporter=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:Number(process.env.SMTP_PORT||587)===465,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
  return transporter.sendMail({from:process.env.SMTP_FROM||'PaperTown <no-reply@papertown.local>',to,subject,html}).then(()=>true);
}
function tokenFor(payload){return crypto.createHmac('sha256',process.env.SESSION_SECRET||'dev-secret').update(payload).digest('hex');}

app.get('/api/me',(req,res)=>res.json({user:user(req)}));
app.post('/api/auth/register',async(req,res)=>{try{const {email,password,displayName}=req.body;if(!email||!password||!displayName)return res.status(400).json({error:'กรอกข้อมูลให้ครบ'});if(password.length<8)return res.status(400).json({error:'รหัสผ่านอย่างน้อย 8 ตัวอักษร'});const hash=await bcrypt.hash(password,10);const info=db.prepare('INSERT INTO users(email,password_hash,display_name,verified) VALUES(?,?,?,0)').run(email.trim().toLowerCase(),hash,displayName.trim());const token=tokenFor(`${info.lastInsertRowid}:${email}`);const link=`${APP_URL}/?verify=${info.lastInsertRowid}.${token}`;const sent=await sendMail(email,'ยืนยันบัญชี PaperTown',`<p>ยินดีต้อนรับสู่ PaperTown</p><p><a href="${link}">ยืนยันอีเมล</a></p>`);res.json({ok:true,sent,devLink:sent?null:link});}catch(e){res.status(400).json({error:e.message.includes('UNIQUE')?'อีเมลนี้มีบัญชีแล้ว':e.message});}});
app.post('/api/auth/verify',async(req,res)=>{const {value}=req.body;try{const [id,sig]=String(value).split('.');const u=db.prepare('SELECT * FROM users WHERE id=?').get(id);if(!u||tokenFor(`${id}:${u.email}`)!==sig)return res.status(400).json({error:'ลิงก์ยืนยันไม่ถูกต้อง'});db.prepare('UPDATE users SET verified=1 WHERE id=?').run(id);session(res,id);res.json({ok:true});}catch(e){res.status(400).json({error:'ลิงก์ไม่ถูกต้อง'});}});
app.post('/api/auth/login',async(req,res)=>{const {email,password}=req.body;const u=db.prepare('SELECT * FROM users WHERE email=?').get(String(email||'').trim().toLowerCase());if(!u||!u.password_hash||!(await bcrypt.compare(password||'',u.password_hash)))return res.status(401).json({error:'อีเมลหรือรหัสผ่านไม่ถูกต้อง'});if(!u.verified)return res.status(403).json({error:'กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ'});session(res,u.id);res.json({ok:true,user:{id:u.id,email:u.email,display_name:u.display_name,role:u.role}});});
app.post('/api/auth/logout',(req,res)=>{if(req.cookies.pt_session)db.prepare('DELETE FROM sessions WHERE token=?').run(req.cookies.pt_session);res.clearCookie('pt_session');res.json({ok:true});});

app.get('/api/books',(req,res)=>{const {q,category,status}=req.query;let sql='SELECT * FROM books WHERE 1=1',p=[];if(q){sql+=' AND (title LIKE ? OR author LIKE ? OR isbn LIKE ?)';const x=`%${q}%`;p.push(x,x,x)}if(category&&category!=='ทั้งหมด'){sql+=' AND category=?';p.push(category)}if(status&&status!=='ทั้งหมด'){sql+=' AND status=?';p.push(status)}sql+=' ORDER BY id DESC';res.json({books:db.prepare(sql).all(...p)});});
app.get('/api/books/:id',(req,res)=>{const b=db.prepare('SELECT * FROM books WHERE id=?').get(req.params.id);if(!b)return res.status(404).json({error:'ไม่พบหนังสือ'});const notes=db.prepare('SELECT n.*,u.display_name FROM notes n JOIN users u ON u.id=n.user_id WHERE book_id=? ORDER BY n.id DESC').all(req.params.id);res.json({book:b,notes});});

app.get('/api/addresses',requireAuth,(req,res)=>res.json({addresses:db.prepare('SELECT * FROM addresses WHERE user_id=? ORDER BY is_default DESC,id DESC').all(req.user.id)}));
app.post('/api/addresses',requireAuth,(req,res)=>{const a=req.body;if(!a.label||!a.recipient||!a.phone||!a.address_line||!a.subdistrict||!a.district||!a.province||!a.postcode)return res.status(400).json({error:'กรอกที่อยู่ให้ครบ'});const tx=db.transaction(()=>{if(a.is_default)db.prepare('UPDATE addresses SET is_default=0 WHERE user_id=?').run(req.user.id);const x=db.prepare('INSERT INTO addresses(user_id,label,recipient,phone,address_line,subdistrict,district,province,postcode,is_default) VALUES(?,?,?,?,?,?,?,?,?,?)').run(req.user.id,a.label,a.recipient,a.phone,a.address_line,a.subdistrict,a.district,a.province,a.postcode,a.is_default?1:0);if(!db.prepare('SELECT 1 FROM addresses WHERE user_id=? AND is_default=1').get(req.user.id))db.prepare('UPDATE addresses SET is_default=1 WHERE id=?').run(x.lastInsertRowid);return x.lastInsertRowid});res.json({ok:true,id:tx()});});
app.put('/api/addresses/:id',requireAuth,(req,res)=>{const a=req.body;if(a.is_default)db.prepare('UPDATE addresses SET is_default=0 WHERE user_id=?').run(req.user.id);db.prepare('UPDATE addresses SET label=?,recipient=?,phone=?,address_line=?,subdistrict=?,district=?,province=?,postcode=?,is_default=? WHERE id=? AND user_id=?').run(a.label,a.recipient,a.phone,a.address_line,a.subdistrict,a.district,a.province,a.postcode,a.is_default?1:0,req.params.id,req.user.id);res.json({ok:true});});
app.delete('/api/addresses/:id',requireAuth,(req,res)=>{db.prepare('DELETE FROM addresses WHERE id=? AND user_id=?').run(req.params.id,req.user.id);res.json({ok:true});});

app.post('/api/borrows',requireAuth,(req,res)=>{const {bookId,method,addressId}=req.body;const b=db.prepare('SELECT * FROM books WHERE id=?').get(bookId);if(!b||b.stock<1)return res.status(400).json({error:'หนังสือเล่มนี้ไม่พร้อมให้ยืม'});if(method==='delivery'&&!addressId)return res.status(400).json({error:'เลือกที่อยู่จัดส่ง'});const due=new Date(Date.now()+14*86400000).toISOString();const tx=db.transaction(()=>{db.prepare('UPDATE books SET stock=stock-1,status=CASE WHEN stock-1>0 THEN \'available\' ELSE \'queue\' END WHERE id=?').run(bookId);return db.prepare('INSERT INTO borrows(user_id,book_id,address_id,method,due_at) VALUES(?,?,?,?,?)').run(req.user.id,bookId,addressId||null,method,due)});res.json({ok:true,id:tx().lastInsertRowid});});
app.get('/api/borrows',requireAuth,(req,res)=>res.json({borrows:db.prepare('SELECT br.*,b.title,b.author,b.cover FROM borrows br JOIN books b ON b.id=br.book_id WHERE br.user_id=? ORDER BY br.id DESC').all(req.user.id)}));
app.post('/api/borrows/:id/return',requireAuth,(req,res)=>{const x=db.prepare('SELECT * FROM borrows WHERE id=? AND user_id=?').get(req.params.id,req.user.id);if(!x)return res.status(404).json({error:'ไม่พบรายการ'});db.prepare('UPDATE borrows SET return_tracking=?,status=\'returning\' WHERE id=?').run(req.body.returnTracking||'',x.id);res.json({ok:true});});
app.post('/api/notes',requireAuth,(req,res)=>{if(!req.body.text?.trim())return res.status(400).json({error:'เขียนข้อความก่อน'});db.prepare('INSERT INTO notes(user_id,book_id,text) VALUES(?,?,?)').run(req.user.id,req.body.bookId,req.body.text.trim());res.json({ok:true});});

app.post('/api/donations',requireAuth,upload.single('photo'),(req,res)=>{const {title,author,condition,deliveryMethod,notes}=req.body;if(!title||!condition||!deliveryMethod)return res.status(400).json({error:'กรอกข้อมูลให้ครบ'});db.prepare('INSERT INTO donations(user_id,title,author,condition,photo,delivery_method,notes) VALUES(?,?,?,?,?,?,?)').run(req.user.id,title,author||'',condition,req.file?`/uploads/${req.file.filename}`:null,deliveryMethod,notes||'');res.json({ok:true});});
app.get('/api/donations',requireAuth,(req,res)=>res.json({donations:db.prepare('SELECT * FROM donations WHERE user_id=? ORDER BY id DESC').all(req.user.id)}));

app.post('/api/ai/note',requireAuth,async(req,res)=>{const text=req.body.text||'';if(!process.env.OPENAI_API_KEY)return res.json({text:`ส่งต่อความรู้สึกดี ๆ จากเล่มนี้: ${text}`});try{const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-5.6-luna',input:`ช่วยเรียบเรียงข้อความ Community Note ภาษาไทยให้สั้น อบอุ่น เป็นธรรมชาติ ไม่สปอยล์หนังสือ จากข้อความนี้: ${text}`})});const j=await r.json();if(!r.ok)throw new Error(j.error?.message||'OpenAI error');res.json({text:j.output_text||text});}catch(e){res.status(502).json({error:e.message});}});

app.get('/api/admin/overview',requireAdmin,(req,res)=>{res.json({stats:{books:db.prepare('SELECT COUNT(*) c FROM books').get().c,users:db.prepare('SELECT COUNT(*) c FROM users WHERE role=\'member\'').get().c,borrowing:db.prepare('SELECT COUNT(*) c FROM borrows WHERE status IN (\'borrowing\',\'returning\')').get().c,pendingDonations:db.prepare('SELECT COUNT(*) c FROM donations WHERE status=\'pending\'').get().c},donations:db.prepare('SELECT d.*,u.display_name,u.email FROM donations d JOIN users u ON u.id=d.user_id ORDER BY d.id DESC').all(),borrows:db.prepare('SELECT br.*,b.title,u.display_name FROM borrows br JOIN books b ON b.id=br.book_id JOIN users u ON u.id=br.user_id ORDER BY br.id DESC').all()});});
app.post('/api/admin/books',requireAdmin,(req,res)=>{const b=req.body;if(!b.title||!b.author||!b.category)return res.status(400).json({error:'กรอกข้อมูลหนังสือให้ครบ'});db.prepare('INSERT INTO books(isbn,title,author,category,description,condition,stock,total,status,cover) VALUES(?,?,?,?,?,?,?,?,?,?)').run(b.isbn||null,b.title,b.author,b.category,b.description||'',b.condition||'ดี',Number(b.stock||1),Number(b.stock||1),Number(b.stock||1)>0?'available':'queue',b.cover||'paper');res.json({ok:true});});
app.put('/api/admin/books/:id',requireAdmin,(req,res)=>{const b=req.body;db.prepare('UPDATE books SET isbn=?,title=?,author=?,category=?,description=?,condition=?,stock=?,total=?,status=? WHERE id=?').run(b.isbn||null,b.title,b.author,b.category,b.description||'',b.condition||'ดี',Number(b.stock||0),Number(b.total||0),Number(b.stock||0)>0?'available':'queue',req.params.id);res.json({ok:true});});
app.delete('/api/admin/books/:id',requireAdmin,(req,res)=>{db.prepare('DELETE FROM books WHERE id=?').run(req.params.id);res.json({ok:true});});
app.post('/api/admin/donations/:id/status',requireAdmin,(req,res)=>{db.prepare('UPDATE donations SET status=?,admin_note=? WHERE id=?').run(req.body.status,req.body.note||'',req.params.id);res.json({ok:true});});
app.post('/api/admin/borrows/:id/tracking',requireAdmin,(req,res)=>{db.prepare('UPDATE borrows SET incoming_tracking=? WHERE id=?').run(req.body.tracking||'',req.params.id);res.json({ok:true});});
app.post('/api/admin/borrows/:id/received',requireAdmin,(req,res)=>{const x=db.prepare('SELECT * FROM borrows WHERE id=?').get(req.params.id);if(x){db.prepare('UPDATE borrows SET status=\'returned\',returned_at=CURRENT_TIMESTAMP WHERE id=?').run(x.id);db.prepare('UPDATE books SET stock=stock+1,status=\'available\' WHERE id=?').run(x.book_id);}res.json({ok:true});});
app.get('/api/admin/barcode/:id',(req,res)=>{const b=db.prepare('SELECT isbn FROM books WHERE id=?').get(req.params.id);if(!b)return res.status(404).end();const code=b.isbn||String(req.params.id).padStart(12,'0');const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="420" height="120"><rect width="100%" height="100%" fill="white"/><g fill="black">${Array.from({length:code.length*5},(_,i)=>`<rect x="${15+i*3}" y="15" width="${i%3===0?2:1}" height="70"/>`).join('')}</g><text x="210" y="105" text-anchor="middle" font-family="Arial" font-size="18">${code}</text></svg>`;res.type('image/svg+xml').send(svg);});

app.get('/api/postcode/:postcode',(req,res)=>{const p=String(req.params.postcode);const known={'70120':{subdistrict:'หน้าเมือง',district:'เมืองราชบุรี',province:'ราชบุรี'},'70000':{subdistrict:'หน้าเมือง',district:'เมืองราชบุรี',province:'ราชบุรี'},'10110':{subdistrict:'คลองเตยเหนือ',district:'วัฒนา',province:'กรุงเทพมหานคร'},'10260':{subdistrict:'บางนา',district:'บางนา',province:'กรุงเทพมหานคร'}};res.json(known[p]||{subdistrict:'',district:'',province:'',message:'ไม่พบข้อมูลอัตโนมัติ กรุณาเลือก/กรอกด้วยตนเอง'});});

app.get('/{*splat}',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`PaperTown running at ${APP_URL}`));
