export async function videoForPhoto(id: string, name: string) {
  const api = window.juno?.video;
  if (!api) throw Error("Le montage nécessite l’application de bureau.");
  const list = await api.list();
  const project = list.projects.find((p) => p.photoProjectId === id);
  if (project) {
    localStorage.setItem("juno-video-project", project.id);
    return project.id;
  }
  const created = await api.create({ name, photoProjectId: id });
  localStorage.setItem("juno-video-project", created.id);
  return created.id;
}
