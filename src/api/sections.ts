import { apiClient } from './client'
import type { Project, SectionDataset, SectionProfile } from './types'

export async function listSectionDatasets(): Promise<SectionDataset[]> {
  const { data } = await apiClient.get<SectionDataset[]>('/api/v1/section-datasets/')
  return data
}

export async function searchProfiles(datasetId: string, search: string): Promise<SectionProfile[]> {
  const { data } = await apiClient.get<SectionProfile[]>(`/api/v1/section-datasets/${datasetId}/profiles/`, {
    params: { search },
  })
  return data
}

export async function approveDataset(datasetId: string, makeDefault: boolean): Promise<SectionDataset> {
  const { data } = await apiClient.post<SectionDataset>(`/api/v1/section-datasets/${datasetId}/approve/`, {
    make_default: makeDefault,
  })
  return data
}

export async function setProjectDataset(projectId: string, datasetId: string): Promise<Project> {
  const { data } = await apiClient.post<Project>(`/api/v1/projects/${projectId}/section-dataset/`, {
    dataset_id: datasetId,
  })
  return data
}
