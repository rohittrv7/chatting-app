/**
 * mediaSaveService.ts — Reliable, verified gallery saving for photos & QR codes.
 *
 * Ensures:
 * 1. Permissions are verified with expo-media-library before saving.
 * 2. File exists and has bytes on disk before attempting to create an asset.
 * 3. Handles Android Scoped Storage (Android 10+) correctly without failing on album moves.
 * 4. Only returns success when an asset is genuinely created and verified in the MediaStore.
 */

import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import { ensureMediaLibraryPermission } from './permissionsService';

export interface MediaSaveResult {
  success: boolean;
  asset?: any;
  error?: string;
}

/**
 * Normalizes a local file path so it has a single valid file:// prefix.
 * Prevents corrupted URIs like file://file:///data/...
 */
export function normalizeLocalFileUri(uri: string): string {
  if (!uri) return '';
  let clean = uri.replace(/^(file:\/\/)+/, 'file://');
  if (!clean.startsWith('file://') && !clean.startsWith('content://')) {
    clean = `file://${clean}`;
  }
  return clean;
}

/**
 * Saves a local image file URI (file://...) to the device Photo Gallery.
 * Verifies file existence on disk, requests write permissions, creates the asset,
 * and handles Scoped Storage gracefully.
 */
export async function saveLocalImageToGallery(localFileUri: string): Promise<MediaSaveResult> {
  try {
    const cleanUri = normalizeLocalFileUri(localFileUri);
    console.log('[MediaSave] Attempting to save image to gallery. Target URI:', cleanUri);

    // 1. Check if the file exists on disk
    const fileInfo = await FileSystem.getInfoAsync(cleanUri);
    console.log('[MediaSave] FileSystem.getInfoAsync result:', fileInfo);

    if (!fileInfo.exists) {
      const err = `File does not exist on disk at path: ${cleanUri}`;
      console.error('[MediaSave]', err);
      return { success: false, error: err };
    }

    if (fileInfo.size === 0) {
      const err = 'Cannot save empty file (0 bytes).';
      console.error('[MediaSave]', err);
      return { success: false, error: err };
    }

    // 2. Ensure Media Library permission
    const hasPermission = await ensureMediaLibraryPermission(true);
    console.log('[MediaSave] ensureMediaLibraryPermission result:', hasPermission);
    if (!hasPermission) {
      return { success: false, error: 'Gallery permission was denied.' };
    }

    // 3. Create Asset in MediaStore / Photos
    console.log('[MediaSave] Calling MediaLibrary.createAssetAsync with:', cleanUri);
    const asset = await MediaLibrary.createAssetAsync(cleanUri);
    console.log('[MediaSave] MediaLibrary.createAssetAsync returned asset:', asset);

    if (!asset || !asset.id) {
      return { success: false, error: 'MediaLibrary did not return a valid saved asset.' };
    }

    // 4. Best-effort album grouping (do NOT fail if album creation/move throws due to Scoped Storage)
    try {
      let album = await MediaLibrary.getAlbumAsync('WhatsApp');
      if (!album) album = await MediaLibrary.getAlbumAsync('Pictures');
      if (!album) {
        await MediaLibrary.createAlbumAsync('WhatsApp', asset, false);
      } else {
        await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
      }
      console.log('[MediaSave] Added asset to WhatsApp/Pictures album');
    } catch (albumErr: any) {
      console.log(
        '[MediaSave] Album organization skipped or not supported on this Android OS version (asset is already saved in Gallery):',
        albumErr?.message || albumErr,
      );
    }

    return { success: true, asset };
  } catch (error: any) {
    console.error('[MediaSave] Error saving image to gallery:', error);
    return { success: false, error: error?.message || 'Failed to save photo to gallery' };
  }
}

/**
 * Saves a base64 encoded image string (e.g. from QRCode.toDataURL) to the device Photo Gallery.
 */
export async function saveBase64ImageToGallery(
  base64Data: string,
  filename = `whatsapp_qr_${Date.now()}.png`,
): Promise<MediaSaveResult> {
  try {
    const cleanB64 = base64Data.replace(/^data:[^;]+;base64,/, '').trim();
    const tempPath = `${FileSystem.cacheDirectory}${filename}`;

    console.log('[MediaSave] Writing base64 image to cache at:', tempPath);
    await FileSystem.writeAsStringAsync(tempPath, cleanB64, {
      encoding: FileSystem.EncodingType.Base64,
    });

    return await saveLocalImageToGallery(tempPath);
  } catch (error: any) {
    console.error('[MediaSave] Error writing/saving base64 image:', error);
    return { success: false, error: error?.message || 'Failed to prepare image for saving' };
  }
}
