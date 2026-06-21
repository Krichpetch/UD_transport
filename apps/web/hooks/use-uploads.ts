import { useMutation } from '@tanstack/react-query'
import { uploadPhoto } from '@/lib/api/uploads'

export function useUploadPhoto() {
  return useMutation({ mutationFn: uploadPhoto })
}
