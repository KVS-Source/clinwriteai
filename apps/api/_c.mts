import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
const u = await p.user.findFirst({ where: { role: 'contributor', status: 'active' }, select: { id: true } })
console.log(u?.id); await p.$disconnect()
