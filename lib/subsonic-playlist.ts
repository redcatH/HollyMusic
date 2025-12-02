import { NextRequest } from 'next/server'
import { formatSubsonicXML, createSubsonicResponse } from './subsonic'
import { type AuthResult } from './auth'
import { PrismaClient, Prisma } from './generated/prisma'
import { logger } from './logger'

const prisma = new PrismaClient()

// 转义 XML 特殊字符
function escapeXml(text: string | number | null | undefined): string {
    if (text === null || text === undefined) return ''
    const str = String(text)
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
}

/**
 * 处理 getPlaylists 请求 - 返回用户的所有播放列表
 */
export async function handleGetPlaylists(request: NextRequest, authRes: AuthResult): Promise<Response> {
    try {
        const url = new URL(request.url)
        const username = url.searchParams.get('username') || authRes.user?.username

        if (!username) {
            const xml = formatSubsonicXML({
                status: 'failed',
                error: { code: 10, message: 'Missing required parameter: username' }
            })
            return createSubsonicResponse(xml)
        }

        // 查询用户的播放列表：自己创建的 + 公开的 + 被授权的
        const userPlaylists = await prisma.playlist.findMany({
            where: {
                OR: [
                    { username },  // 用户创建的歌单
                    { isPublic: true },  // 公开歌单
                    { allowedUsers: { some: { username } } }  // 被授权的歌单
                ]
            },
            include: {
                allowedUsers: true  // 加载所有授权用户
            },
            orderBy: { createdAt: 'desc' }
        })

        // 生成 playlist 节点 - 如果属于当前用户则显示 allowedUser 子节点；否则使用自闭合标签
        const playlistNodes = userPlaylists.map(p => {
            const isOwner = p.username === username
            // 格式化时间为 Subsonic 格式: yyyy-MM-dd HH:mm:ss
            const createdStr = p.createdAt.toISOString().replace('T', ' ').substring(0, 19)

            const attrs = `id="${p.id}" name="${escapeXml(p.name)}" comment="${escapeXml(p.comment)}" owner="${escapeXml(p.owner || p.username)}" public="${p.isPublic}" songCount="${p.songCount}" created="${createdStr}"`

            if (isOwner && p.allowedUsers.length > 0) {
                // 属于当前用户且有授权用户的歌单，显示 allowedUser 子节点
                const allowedUserNodes = p.allowedUsers.map(au =>
                    `    <allowedUser>${escapeXml(au.username)}</allowedUser>`
                ).join('\n')
                return `  <playlist ${attrs}>\n${allowedUserNodes}\n  </playlist>`
            } else {
                // 不是所有者的歌单或没有授权用户的歌单使用自闭合标签
                return `  <playlist ${attrs} />`
            }
        }).join('\n')

        const xml =formatSubsonicXML({status:'ok',children:`<playlists><allowedUser/>${playlistNodes}</playlists>`})

        return new Response(xml, {
            status: 200,
            headers: {
                'Content-Type': 'application/xml; charset=utf-8',
                'Content-Length': String(Buffer.byteLength(xml, 'utf8'))
            }
        })
    } catch (err) {
        logger.error('[getPlaylists] Error:', err)
        const xml = formatSubsonicXML({
            status: 'failed',
            error: { code: 0, message: 'Internal server error' }
        })
        return createSubsonicResponse(xml)
    }
}

/**
 * 处理 getPlaylist 请求 - 返回指定播放列表的详细信息（包含歌曲）
 */
export async function handleGetPlaylist(request: NextRequest, authRes: AuthResult): Promise<Response> {
    try {
        const url = new URL(request.url)
        const idStr = url.searchParams.get('id')
        if (!idStr) {
            const xml = formatSubsonicXML({
                status: 'failed',
                error: { code: 10, message: 'Missing required parameter: id' }
            })
            return createSubsonicResponse(xml)
        }

        const playlistId = parseInt(idStr, 10)
        if (isNaN(playlistId)) {
            const xml = formatSubsonicXML({
                status: 'failed',
                error: { code: 70, message: 'Invalid playlist id' }
            })
            return createSubsonicResponse(xml)
        }

        // 查询播放列表及其条目
        const playlist = await prisma.playlist.findUnique({
            where: { id: playlistId },
            include: {
                entries: {
                    orderBy: { position: 'asc' },
                    include: { musicInfo: true }
                },
                allowedUsers: true
            }
        })

        if (!playlist) {
            const xml = formatSubsonicXML({
                status: 'failed',
                error: { code: 70, message: 'Playlist not found' }
            })
            return createSubsonicResponse(xml)
        }

        // 权限检查：非公开列表只有owner和被授权用户可以访问
        const username = authRes.user?.username
        const isOwner = playlist.username === username
        const isAllowed = playlist.allowedUsers.some(au => au.username === username)

        if (!playlist.isPublic && !isOwner && !isAllowed) {
            const xml = formatSubsonicXML({
                status: 'failed',
                error: { code: 50, message: 'Access denied' }
            })
            return createSubsonicResponse(xml)
        }

        // 格式化时间为 Subsonic 格式: yyyy-MM-dd HH:mm:ss
        const createdStr = playlist.createdAt.toISOString().replace('T', ' ').substring(0, 19)

        // 生成 allowedUser 子节点
        const allowedUserNodes = playlist.allowedUsers.map(au =>
            `\t<allowedUser>${escapeXml(au.username)}</allowedUser>`
        ).join('\n')

        // 生成 entry 节点（映射为 Subsonic song 格式）
        const entryNodes = playlist.entries.map(entry => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let musicData: any = {}

            // 优先使用 musicInfo，否则解析 snapshot
            if (entry.musicInfo) {

                const mi = entry.musicInfo
                musicData = {
                    id: mi.songmid,
                    title: mi.name || '',
                    artist: mi.singer || '',
                    album: mi.albumName || '',
                    coverArt: `pl-${playlist.id}`,
                    duration: mi.durationSeconds || 0,
                    parent: playlist.id || '',
                    albumId: mi.albumId || '',
                    artistId: '',
                    year: '',
                    genre: '',
                    size: 0,
                    suffix: 'mp3',
                    contentType: 'audio/mpeg',
                    path: `${mi.singer || 'Unknown'}/${mi.albumName || 'Unknown'}/${mi.name || 'Unknown'}.mp3`
                }
                return `\t<entry id="${escapeXml(musicData.id)}" parent="${escapeXml(musicData.parent)}" title="${escapeXml(musicData.title)}" album="${escapeXml(musicData.album)}" artist="${escapeXml(musicData.artist)}" isDir="false" coverArt="${escapeXml(musicData.coverArt)}" created="${entry.addedAt.toISOString()}" duration="${musicData.duration}" bitRate="320" track="0" year="${escapeXml(musicData.year)}" genre="${escapeXml(musicData.genre)}" size="${musicData.size}" suffix="${escapeXml(musicData.suffix)}" contentType="${escapeXml(musicData.contentType)}" isVideo="false" path="${escapeXml(musicData.path)}" albumId="${escapeXml(musicData.albumId)}" artistId="${escapeXml(musicData.artistId)}" type="music"/>`
            } 
            else if (entry.snapshotJson) {
                return '';
                // try {
                //     const snapshot = JSON.parse(entry.snapshotJson)
                //     musicData = {
                //         id: snapshot.songmid || entry.songmid || '',
                //         title: snapshot.name || '',
                //         artist: snapshot.singer || '',
                //         album: snapshot.albumName || '',
                //         coverArt: `pl-${playlist.id}`,
                //         duration: snapshot.durationSeconds || 0,
                //         parent: snapshot.albumId || '',
                //         albumId: snapshot.albumId || '',
                //         artistId: '',
                //         year: '',
                //         genre: '',
                //         size: 0,
                //         suffix: 'mp3',
                //         contentType: 'audio/mpeg',
                //         path: `${snapshot.singer || 'Unknown'}/${snapshot.albumName || 'Unknown'}/${snapshot.name || 'Unknown'}.mp3`
                //     }
                // } catch {
                //     logger.warn('[getPlaylist] Failed to parse snapshot for entry', entry.id)
                // }
                return `\t<entry id="${escapeXml(musicData.id)}" parent="${escapeXml(musicData.parent)}" title="${escapeXml(musicData.title)}" album="${escapeXml(musicData.album)}" artist="${escapeXml(musicData.artist)}" isDir="false" coverArt="${escapeXml(musicData.coverArt)}" created="${entry.addedAt.toISOString()}" duration="${musicData.duration}" bitRate="320" track="0" year="${escapeXml(musicData.year)}" genre="${escapeXml(musicData.genre)}" size="${musicData.size}" suffix="${escapeXml(musicData.suffix)}" contentType="${escapeXml(musicData.contentType)}" isVideo="false" path="${escapeXml(musicData.path)}" albumId="${escapeXml(musicData.albumId)}" artistId="${escapeXml(musicData.artistId)}" type="music"/>`
            }

            
        }).join('\n')

        // 构建 playlist 子节点内容
        const childNodes = [
            allowedUserNodes,
            entryNodes
        ].filter(Boolean).join('\n')

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<subsonic-response xmlns="http://subsonic.org/restapi" status="ok" version="1.16.1" type="navidrome">
\t<playlist id="${playlist.id}" name="${escapeXml(playlist.name)}" comment="${escapeXml(playlist.comment)}" owner="${escapeXml(playlist.owner || playlist.username)}" public="${playlist.isPublic}" songCount="${playlist.songCount}" duration="${playlist.duration || 0}" created="${createdStr}" coverArt="${escapeXml(playlist.coverArt || `pl-${playlist.id}`)}">
${childNodes}
\t</playlist>
</subsonic-response>`

        return new Response(xml, {
            status: 200,
            headers: {
                'Content-Type': 'application/xml; charset=utf-8',
                'Content-Length': String(Buffer.byteLength(xml, 'utf8'))
            }
        })
    } catch (err) {
        logger.error('[getPlaylist] Error:', err)
        const xml = formatSubsonicXML({
            status: 'failed',
            error: { code: 0, message: 'Internal server error' }
        })
        return createSubsonicResponse(xml)
    }
}

/**
 * 处理 createPlaylist 请求 - 创建或更新播放列表
 */
export async function handleCreatePlaylist(request: NextRequest, authRes: AuthResult): Promise<Response> {
    try {
        const url = new URL(request.url)
        const playlistId = url.searchParams.get('playlistId')
        const name = url.searchParams.get('name')
        const username = authRes.user?.username

        if (!username) {
            const xml = formatSubsonicXML({
                status: 'failed',
                error: { code: 10, message: 'User not authenticated' }
            })
            return createSubsonicResponse(xml)
        }

        // 更新现有播放列表
        if (playlistId) {
            const id = parseInt(playlistId, 10)
            if (isNaN(id)) {
                const xml = formatSubsonicXML({
                    status: 'failed',
                    error: { code: 70, message: 'Invalid playlist id' }
                })
                return createSubsonicResponse(xml)
            }

            // 检查播放列表是否存在且用户有权限
            const existing = await prisma.playlist.findUnique({
                where: { id }
            })

            if (!existing) {
                const xml = formatSubsonicXML({
                    status: 'failed',
                    error: { code: 70, message: 'Playlist not found' }
                })
                return createSubsonicResponse(xml)
            }

            if (existing.username !== username) {
                const xml = formatSubsonicXML({
                    status: 'failed',
                    error: { code: 50, message: 'Access denied' }
                })
                return createSubsonicResponse(xml)
            }

            // 更新播放列表名称
            if (name) {
                await prisma.playlist.update({
                    where: { id },
                    data: { name }
                })
                logger.info(`[createPlaylist] Updated playlist ${id} name to: ${name}`)
            }

            const xml = formatSubsonicXML({ status: 'ok' })
            return createSubsonicResponse(xml)
        }

        // 创建新播放列表
        if (!name) {
            const xml = formatSubsonicXML({
                status: 'failed',
                error: { code: 10, message: 'Missing required parameter: name' }
            })
            return createSubsonicResponse(xml)
        }

        const newPlaylist = await prisma.playlist.create({
            data: {
                name,
                username,
                owner: username,
                isPublic: false,
                songCount: 0,
                duration: 0,
                // 创建时自动将创建者添加到 allowedUsers
                allowedUsers: {
                    create: {
                        username
                    }
                }
            }
        })

        logger.info(`[createPlaylist] Created new playlist: ${newPlaylist.id} - ${name}`)

        const xml = formatSubsonicXML({
            status: 'ok', children: `
            <playlist id="${newPlaylist.id}" name="${newPlaylist.name}" comment="" owner="${newPlaylist.owner}" songCount="${newPlaylist.songCount}" public="${newPlaylist.isPublic}"
        created="${new Date().toISOString()}">
        <allowedUser>${newPlaylist.owner}</allowedUser>
    </playlist>
        ` })
        return createSubsonicResponse(xml)
    } catch (err) {
        logger.error('[createPlaylist] Error:', err)
        const xml = formatSubsonicXML({
            status: 'failed',
            error: { code: 0, message: 'Internal server error' }
        })
        return createSubsonicResponse(xml)
    }
}

/**
 * 处理 deletePlaylist 请求 - 删除播放列表
 */
export async function handleDeletePlaylist(request: NextRequest, authRes: AuthResult): Promise<Response> {
    try {
        const url = new URL(request.url)
        const idStr = url.searchParams.get('id')
        const username = authRes.user?.username

        if (!username) {
            const xml = formatSubsonicXML({
                status: 'failed',
                error: { code: 10, message: 'User not authenticated' }
            })
            return createSubsonicResponse(xml)
        }

        if (!idStr) {
            const xml = formatSubsonicXML({
                status: 'failed',
                error: { code: 10, message: 'Missing required parameter: id' }
            })
            return createSubsonicResponse(xml)
        }

        const id = parseInt(idStr, 10)
        if (isNaN(id)) {
            const xml = formatSubsonicXML({
                status: 'failed',
                error: { code: 70, message: 'Invalid playlist id' }
            })
            return createSubsonicResponse(xml)
        }

        // 检查播放列表是否存在且用户有权限
        const playlist = await prisma.playlist.findUnique({
            where: { id }
        })

        if (!playlist) {
            const xml = formatSubsonicXML({
                status: 'failed',
                error: { code: 70, message: 'Playlist not found' }
            })
            return createSubsonicResponse(xml)
        }

        if (playlist.username !== username) {
            const xml = formatSubsonicXML({
                status: 'failed',
                error: { code: 50, message: 'Access denied' }
            })
            return createSubsonicResponse(xml)
        }

        // 删除播放列表（会级联删除 entries 和 allowedUsers）
        await prisma.playlist.delete({
            where: { id }
        })

        logger.info(`[deletePlaylist] Deleted playlist: ${id} - ${playlist.name}`)

        const xml = formatSubsonicXML({ status: 'ok' })
        return createSubsonicResponse(xml)
    } catch (err) {
        logger.error('[deletePlaylist] Error:', err)
        const xml = formatSubsonicXML({
            status: 'failed',
            error: { code: 0, message: 'Internal server error' }
        })
        return createSubsonicResponse(xml)
    }
}

/**
 * 处理 updatePlaylist 请求 - 更新歌单元数据、添加或删除歌曲
 * 支持参数：playlistId (required), name, comment, public, songIdToAdd (comma separated), songIndexToRemove (comma separated of song ids)
 */
export async function handleUpdatePlaylist(request: NextRequest, authRes: AuthResult): Promise<Response> {
    try {
        const url = new URL(request.url)
        const playlistIdStr = url.searchParams.get('playlistId')
        if (!playlistIdStr) {
            const xml = formatSubsonicXML({ status: 'failed', error: { code: 10, message: 'Missing required parameter: playlistId' } })
            return createSubsonicResponse(xml)
        }

        const playlistId = parseInt(playlistIdStr, 10)
        if (isNaN(playlistId)) {
            const xml = formatSubsonicXML({ status: 'failed', error: { code: 70, message: 'Invalid playlist id' } })
            return createSubsonicResponse(xml)
        }

        const username = authRes.user?.username
        if (!username) {
            const xml = formatSubsonicXML({ status: 'failed', error: { code: 40, message: 'Authentication required' } })
            return createSubsonicResponse(xml)
        }

        const existing = await prisma.playlist.findUnique({ where: { id: playlistId }, include: { entries: { orderBy: { position: 'asc' } } } })
        if (!existing) {
            const xml = formatSubsonicXML({ status: 'failed', error: { code: 70, message: 'Playlist not found' } })
            return createSubsonicResponse(xml)
        }

        if (existing.username !== username) {
            const xml = formatSubsonicXML({ status: 'failed', error: { code: 50, message: 'Access denied' } })
            return createSubsonicResponse(xml)
        }

        // 更新元数据: name/comment/public
        const name = url.searchParams.get('name')
        const comment = url.searchParams.get('comment')
        const publicParam = url.searchParams.get('public')
        const updates: Prisma.PlaylistUpdateInput = {}
        if (name !== null) updates.name = name
        if (comment !== null) updates.comment = comment
        if (publicParam !== null) updates.isPublic = publicParam === 'true' || publicParam === '1'

        if (Object.keys(updates).length > 0) {
            await prisma.playlist.update({ where: { id: playlistId }, data: updates })
        }

        // 处理删除与添加
        // local parameter parser (comma/space/semicolon separated)
        function parseListParam(raw: string | null): string[] {
            if (!raw) return []
            return raw.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)
        }

        const songIdToAdd = parseListParam(url.searchParams.get('songIdToAdd'))
        const songIndexToRemove = parseListParam(url.searchParams.get('songIndexToRemove'))

        // 删除：按 songmid 删除所有匹配的条目
        if (songIndexToRemove.length > 0) {
            for (const sid of songIndexToRemove) {
                await prisma.playlistEntry.deleteMany({ where: { playlistId, position: parseInt(sid, 10) + 1 } })
            }
            // 重新排序 positions
            const remaining = await prisma.playlistEntry.findMany({ where: { playlistId }, orderBy: { position: 'asc' } })
            for (let i = 0; i < remaining.length; i++) {
                const pos = i + 1
                if (remaining[i].position !== pos) {
                    await prisma.playlistEntry.update({ where: { id: remaining[i].id }, data: { position: pos } })
                }
            }
        }

        // 添加：查找 musicInfo，如果有则关联，否则只插入 songmid
        if (songIdToAdd.length > 0) {
            // 获取当前最大 position
            const maxPosRow = await prisma.playlistEntry.findFirst({ where: { playlistId }, orderBy: { position: 'desc' }, select: { position: true } })
            let pos = maxPosRow?.position ?? 0

            // 去重并跳过已存在的 songmid
            const seen = new Set<string>()
            for (const rawSid of songIdToAdd) {
                const sid = String(rawSid).trim()
                if (!sid) continue
                // 本次请求内去重
                if (seen.has(sid)) continue
                seen.add(sid)

                // 如果该歌已经在歌单中存在，则跳过添加
                const existsEntry = await prisma.playlistEntry.findFirst({ where: { playlistId, songmid: sid } })
                if (existsEntry) {
                    logger.info(`[updatePlaylist] Skipping duplicate song ${sid} for playlist ${playlistId}`)
                    continue
                }

                pos++
                // 查找 MusicInfo（使用 findFirst 兼容非唯一索引）
                const mi = await prisma.musicInfo.findFirst({ where: { songmid: sid } })
                await prisma.playlistEntry.create({ data: {
                    playlistId,
                    musicInfoId: mi?.id ?? null,
                    songmid: sid,
                    position: pos,
                    addedBy: username
                } })
            }
        }

        // 更新 songCount and duration
        const total = await prisma.playlistEntry.count({ where: { playlistId } })
        // 计算总时长（如果有 musicInfo.durationSeconds 字段）
        const entriesWithMi = await prisma.playlistEntry.findMany({ where: { playlistId }, include: { musicInfo: true } })
        const totalDuration = entriesWithMi.reduce((acc, e) => acc + (e.musicInfo?.durationSeconds ?? 0), 0)
        await prisma.playlist.update({ where: { id: playlistId }, data: { songCount: total, duration: totalDuration } })

        const xml = formatSubsonicXML({ status: 'ok' })
        return createSubsonicResponse(xml)
    } catch (err) {
        logger.error('[updatePlaylist] Error:', err)
        const xml = formatSubsonicXML({ status: 'failed', error: { code: 0, message: 'Internal server error' } })
        return createSubsonicResponse(xml)
    }
}
