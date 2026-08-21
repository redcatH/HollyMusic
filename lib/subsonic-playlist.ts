import { NextRequest } from 'next/server'
import { respond, subsonicError, type SubsonicPlaylistNode } from './subsonic'
import { type AuthResult } from './auth'
import { PrismaClient, Prisma } from './generated/prisma'
import { logger } from './logger'

const prisma = new PrismaClient()

/**
 * 处理 getPlaylists 请求 - 返回用户的所有播放列表
 */
export async function handleGetPlaylists(request: NextRequest, authRes: AuthResult): Promise<Response> {
    try {
        // 用户名强制取自认证结果，不接受 query 参数指定他人身份（防越权读取他人歌单）
        const username = authRes.user?.username

        if (!username) {
            return subsonicError(request, 10, 'Missing required parameter: username')
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

        // 生成 playlist 节点（XML 转义由渲染层统一处理）
        const playlistNodes: SubsonicPlaylistNode[] = userPlaylists.map(p => {
            const isOwner = p.username === username
            // 格式化时间为 Subsonic 格式: yyyy-MM-dd HH:mm:ss
            const createdStr = p.createdAt.toISOString().replace('T', ' ').substring(0, 19)

            const node: SubsonicPlaylistNode = {
                id: String(p.id),
                name: p.name,
                comment: p.comment ?? '',
                owner: p.owner || p.username,
                public: p.isPublic,
                songCount: p.songCount,
                duration: p.duration || 0,
                created: createdStr,
                coverArt: p.coverArt || `pl-${p.id}`,
            }
            // 只有属于当前用户且有授权用户的歌单才显示 allowedUser 子节点
            if (isOwner && p.allowedUsers.length > 0) {
                node.allowedUser = p.allowedUsers.map(au => au.username)
            }
            return node
        })

        return respond(request, { playlists: { playlist: playlistNodes } })
    } catch (err) {
        logger.error('[getPlaylists] Error:', err)
        return subsonicError(request, 0, 'Internal server error')
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
            return subsonicError(request, 10, 'Missing required parameter: id')
        }

        const playlistId = parseInt(idStr, 10)
        if (isNaN(playlistId)) {
            return subsonicError(request, 70, 'Invalid playlist id')
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
            return subsonicError(request, 70, 'Playlist not found')
        }

        // 权限检查：非公开列表只有owner和被授权用户可以访问
        const username = authRes.user?.username
        const isOwner = playlist.username === username
        const isAllowed = playlist.allowedUsers.some(au => au.username === username)

        if (!playlist.isPublic && !isOwner && !isAllowed) {
            return subsonicError(request, 50, 'Access denied')
        }

        // 格式化时间为 Subsonic 格式: yyyy-MM-dd HH:mm:ss
        const createdStr = playlist.createdAt.toISOString().replace('T', ' ').substring(0, 19)

        // 生成 entry 节点（映射为 Subsonic song 格式；snapshot 条目暂跳过）
        const entryNodes = playlist.entries.map(entry => {
            const mi = entry.musicInfo
            if (!mi) return null

            const entryId = `${mi.source}-${mi.songmid}`
            return {
                id: entryId,
                parent: String(playlist.id ?? ''),
                title: mi.name || '',
                album: mi.albumName || '',
                artist: mi.singer || '',
                isDir: false,
                coverArt: entryId,
                created: entry.addedAt.toISOString(),
                duration: mi.durationSeconds || 0,
                bitRate: 320,
                track: 0,
                year: '',
                genre: '',
                size: 0,
                suffix: 'mp3',
                contentType: 'audio/mpeg',
                isVideo: false,
                path: `${mi.singer || 'Unknown'}/${mi.albumName || 'Unknown'}/${mi.name || 'Unknown'}.mp3`,
                albumId: entryId,
                artistId: '',
                type: 'music',
            }
        }).filter((e): e is NonNullable<typeof e> => e !== null)

        return respond(request, {
            playlist: {
                id: String(playlist.id),
                name: playlist.name,
                comment: playlist.comment ?? '',
                owner: playlist.owner || playlist.username,
                public: playlist.isPublic,
                songCount: playlist.songCount,
                duration: playlist.duration || 0,
                created: createdStr,
                coverArt: playlist.coverArt || `pl-${playlist.id}`,
                allowedUser: playlist.allowedUsers.map(au => au.username),
                entry: entryNodes,
            },
        }, {
            // 保留 navidrome 兼容标记（部分客户端据此启用 Navidrome 专属行为）
            rootAttrs: { type: 'navidrome' },
        })
    } catch (err) {
        logger.error('[getPlaylist] Error:', err)
        return subsonicError(request, 0, 'Internal server error')
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
            return subsonicError(request, 10, 'User not authenticated')
        }

        // 更新现有播放列表
        if (playlistId) {
            const id = parseInt(playlistId, 10)
            if (isNaN(id)) {
                return subsonicError(request, 70, 'Invalid playlist id')
            }

            // 检查播放列表是否存在且用户有权限
            const existing = await prisma.playlist.findUnique({
                where: { id }
            })

            if (!existing) {
                return subsonicError(request, 70, 'Playlist not found')
            }

            if (existing.username !== username) {
                return subsonicError(request, 50, 'Access denied')
            }

            // 更新播放列表名称
            if (name) {
                await prisma.playlist.update({
                    where: { id },
                    data: { name }
                })
                logger.info(`[createPlaylist] Updated playlist ${id} name to: ${name}`)
            }

            return respond(request, null)
        }

        // 创建新播放列表
        if (!name) {
            return subsonicError(request, 10, 'Missing required parameter: name')
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

        return respond(request, {
            playlist: {
                id: String(newPlaylist.id),
                name: newPlaylist.name,
                comment: '',
                owner: newPlaylist.owner ?? username,
                songCount: newPlaylist.songCount,
                public: newPlaylist.isPublic,
                created: new Date().toISOString(),
                allowedUser: [newPlaylist.owner ?? username],
            },
        })
    } catch (err) {
        logger.error('[createPlaylist] Error:', err)
        return subsonicError(request, 0, 'Internal server error')
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
            return subsonicError(request, 10, 'User not authenticated')
        }

        if (!idStr) {
            return subsonicError(request, 10, 'Missing required parameter: id')
        }

        const id = parseInt(idStr, 10)
        if (isNaN(id)) {
            return subsonicError(request, 70, 'Invalid playlist id')
        }

        // 检查播放列表是否存在且用户有权限
        const playlist = await prisma.playlist.findUnique({
            where: { id }
        })

        if (!playlist) {
            return subsonicError(request, 70, 'Playlist not found')
        }

        if (playlist.username !== username) {
            return subsonicError(request, 50, 'Access denied')
        }

        // 删除播放列表（会级联删除 entries 和 allowedUsers）
        await prisma.playlist.delete({
            where: { id }
        })

        logger.info(`[deletePlaylist] Deleted playlist: ${id} - ${playlist.name}`)

        return respond(request, null)
    } catch (err) {
        logger.error('[deletePlaylist] Error:', err)
        return subsonicError(request, 0, 'Internal server error')
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
            return subsonicError(request, 10, 'Missing required parameter: playlistId')
        }

        const playlistId = parseInt(playlistIdStr, 10)
        if (isNaN(playlistId)) {
            return subsonicError(request, 70, 'Invalid playlist id')
        }

        const username = authRes.user?.username
        if (!username) {
            return subsonicError(request, 40, 'Authentication required')
        }

        const existing = await prisma.playlist.findUnique({ where: { id: playlistId }, include: { entries: { orderBy: { position: 'asc' } } } })
        if (!existing) {
            return subsonicError(request, 70, 'Playlist not found')
        }

        if (existing.username !== username) {
            return subsonicError(request, 50, 'Access denied')
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
                // 查找 MusicInfo 行（song id 为 `source-songmid` 复合格式，解析后精确匹配拿 DB 行 id 做关联）
                let miRow: { id: number } | null = null
                if (sid.includes('-')) {
                  const idx = sid.indexOf('-')
                  const src = sid.substring(0, idx)
                  const mid = sid.substring(idx + 1)
                  if (src && mid) {
                    miRow = await prisma.musicInfo.findUnique({
                      where: { source_songmid: { source: src, songmid: mid } },
                      select: { id: true },
                    })
                  }
                }
                if (!miRow) {
                  miRow = await prisma.musicInfo.findFirst({ where: { songmid: sid }, select: { id: true }, orderBy: { id: 'asc' } })
                }
                await prisma.playlistEntry.create({ data: {
                    playlistId,
                    musicInfoId: miRow?.id ?? null,
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

        return respond(request, null)
    } catch (err) {
        logger.error('[updatePlaylist] Error:', err)
        return subsonicError(request, 0, 'Internal server error')
    }
}
