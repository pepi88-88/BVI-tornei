import { NextResponse } from 'next/server'
export async function POST(){ const r=NextResponse.redirect('/'); r.cookies.set('admin_session','',{httpOnly:true,path:'/',maxAge:0}); return r }
